import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import {
  EventType,
  TraceSource,
  SSTResource,
  BuildEvent,
  TaskEvent,
  CompletionEvent,
  FailureEvent,
  HealthReportEvent,
} from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { Resource } from 'sst';
import { SYSTEM, DYNAMO_KEYS } from '../lib/constants';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const typedResource = Resource as unknown as SSTResource;
const eb = new EventBridgeClient({});

/**
 * Wake up the initiator agent when a delegated task or system event completes.
 */
async function wakeupInitiator(
  userId: string,
  initiatorId: string | undefined,
  task: string,
  traceId: string | undefined,
  sessionId: string | undefined,
  depth: number = 0
) {
  if (!initiatorId || !task) return;

  const initiatorAgentId = initiatorId.endsWith('.agent')
    ? initiatorId.replace('.agent', '')
    : initiatorId;

  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'events.handler',
          DetailType: EventType.CONTINUATION_TASK,
          Detail: JSON.stringify({
            userId,
            agentId: initiatorAgentId,
            task,
            traceId,
            initiatorId,
            sessionId,
            depth: depth + 1,
          }),
          EventBusName: typedResource.AgentBus.name,
        },
      ],
    })
  );
}

/**
 * Handles system-level events such as build successes or failures.
 * Triggers agent processing for failures and sends notifications to users.
 *
 * @param event - The EventBridge event containing detail-type and detail.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves when the event has been processed.
 */
export const handler = async (
  event: {
    'detail-type': string;
    detail: Record<string, unknown>;
  },
  context: Context
): Promise<void> => {
  logger.info('EventHandler received event:', JSON.stringify(event, null, 2));

  if (event['detail-type'] === EventType.SYSTEM_BUILD_FAILED) {
    const {
      userId,
      buildId,
      errorLogs,
      traceId,
      gapIds,
      sessionId,
      initiatorId,
      task: originalTask,
    } = event.detail as unknown as BuildEvent;

    const gapsContext =
      gapIds && gapIds.length > 0
        ? `This deployment was addressing the following gaps: ${gapIds.join(', ')}.`
        : '';
    const traceContext = traceId
      ? `Refer to the previous reasoning trace for context: ${traceId}`
      : '';

    const task = `CRITICAL: Deployment ${buildId} failed. 
    ${gapsContext}
    ${traceContext}

    Here are the last few lines of the logs:
    ---
    ${errorLogs}
    ---
    Please investigate the codebase using your tools, find the root cause, fix the issue, and trigger a new deployment. 
    Explain your plan to the user before proceeding.`;

    // Process the failure context via the SuperClaw
    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig('main');
    if (!config) {
      logger.error('Main agent config missing in events handler');
      return;
    }

    const agentTools = await getAgentTools('events');
    const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);
    const responseText = await agent.process(userId, `SYSTEM_NOTIFICATION: ${task}`, {
      context,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
    });

    // Notify user via Notifier (if not paused)
    if (!responseText.startsWith('TASK_PAUSED')) {
      await sendOutboundMessage(
        'events.handler',
        userId,
        responseText,
        undefined,
        sessionId,
        'SuperClaw'
      );
    }

    // WAKE UP INITIATOR
    if (initiatorId && originalTask) {
      await wakeupInitiator(
        userId,
        initiatorId,
        `BUILD_FAILURE_NOTIFICATION: The deployment for your task "${originalTask}" failed. 
        Error details:
        ---
        ${errorLogs}
        ---
        Please decide on the next course of action.`,
        traceId,
        sessionId
      );
    }
  } else if (event['detail-type'] === EventType.SYSTEM_BUILD_SUCCESS) {
    const { userId, buildId, sessionId, initiatorId, task, traceId } =
      event.detail as unknown as BuildEvent;

    const message = `✅ **DEPLOYMENT SUCCESSFUL**
Build ID: ${buildId}

The system has successfully evolved and all planned gaps have been marked as DONE. 
I am ready for further tasks or instructions.`;

    await sendOutboundMessage('events.handler', userId, message, undefined, sessionId, 'SuperClaw');

    // WAKE UP INITIATOR
    if (initiatorId && task) {
      await wakeupInitiator(
        userId,
        initiatorId,
        `BUILD_SUCCESS_NOTIFICATION: The deployment for your task "${task}" was successful (Build: ${buildId}). Please perform any post-deployment configuration or verification steps.`,
        traceId,
        sessionId
      );
    }
  } else if (event['detail-type'] === EventType.CONTINUATION_TASK) {
    const { userId, agentId, task, traceId, sessionId, isContinuation, depth, initiatorId } =
      event.detail as unknown as TaskEvent & { agentId?: string };

    const targetAgentId = agentId || 'main';
    logger.info(`Handling continuation task for agent ${targetAgentId}, user:`, userId, {
      traceId,
      sessionId,
    });

    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig(targetAgentId);
    if (!config) {
      logger.error(`Agent configuration for '${targetAgentId}' not found during continuation.`);
      return;
    }

    const agentTools = await getAgentTools(targetAgentId === 'main' ? 'events' : targetAgentId);
    const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

    // Resume with isContinuation = true
    const responseText = await agent.process(userId, task, {
      context,
      isContinuation: isContinuation !== false, // Default to true for CONTINUATION_TASK
      traceId,
      sessionId,
      depth,
      initiatorId,
      source: TraceSource.SYSTEM,
    });

    if (!responseText.startsWith('TASK_PAUSED')) {
      await sendOutboundMessage(
        'events.handler',
        userId,
        responseText,
        undefined,
        sessionId,
        'SuperClaw'
      );
    }
  } else if (event['detail-type'] === EventType.SYSTEM_HEALTH_REPORT) {
    const {
      component,
      issue,
      severity,
      context: issueContext,
      userId,
      traceId,
      sessionId,
    } = event.detail as unknown as HealthReportEvent;

    const triageTask = `SYSTEM HEALTH ALERT: A component has reported an internal issue.
    
    Component: ${component}
    Issue: ${issue}
    Severity: ${severity.toUpperCase()}
    
    Context:
    ${JSON.stringify(issueContext || {}, null, 2)}
    
    Please investigate this health issue. Determine if it requires a code modification (Coder Agent), configuration change, or if it can be resolved via an autonomous recovery action.
    Start by diagnosing the root cause using your tools.`;

    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig('main');
    if (!config) {
      logger.error('Main agent config missing during health triage');
      return;
    }

    const agentTools = await getAgentTools('events');
    const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);
    const responseText = await agent.process(userId, `HEALTH_TRIAGE: ${triageTask}`, {
      context,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
    });

    if (!responseText.startsWith('TASK_PAUSED')) {
      await sendOutboundMessage(
        'events.handler',
        userId,
        `🚨 **SYSTEM HEALTH ALERT** (${severity.toUpperCase()})\nComponent: ${component}\nIssue: ${issue}\n\nSuperClaw response: ${responseText}`,
        undefined,
        sessionId,
        'SuperClaw'
      );
    }
  } else if (
    event['detail-type'] === EventType.TASK_COMPLETED ||
    event['detail-type'] === EventType.TASK_FAILED
  ) {
    const isFailure = event['detail-type'] === EventType.TASK_FAILED;
    const { userId, agentId, task, traceId, initiatorId, depth, sessionId } =
      event.detail as unknown as CompletionEvent & FailureEvent;

    const response = isFailure
      ? (event.detail as unknown as FailureEvent).error
      : (event.detail as unknown as CompletionEvent).response;

    const currentDepth = depth || 1;
    logger.info(
      `Relaying ${isFailure ? 'failure' : 'completion'} from ${agentId} to Initiator: ${initiatorId || 'Orchestrator'} (Depth: ${currentDepth}, Session: ${sessionId})`
    );

    // 1. Loop Protection
    // Resolve recursion limit from DDB or fallback to default
    let RECURSION_LIMIT: number = SYSTEM.DEFAULT_RECURSION_LIMIT;
    try {
      const { AgentRegistry } = await import('../lib/registry');
      const customLimit = await AgentRegistry.getRawConfig(DYNAMO_KEYS.RECURSION_LIMIT);
      if (customLimit !== undefined) {
        RECURSION_LIMIT = parseInt(String(customLimit), 10);
      }
    } catch {
      logger.warn('Failed to fetch recursion_limit from DDB, using default.');
    }

    if (currentDepth >= RECURSION_LIMIT) {
      logger.error(
        `Recursion Limit Exceeded (Depth: ${currentDepth}) for user ${userId}. Aborting.`
      );
      await sendOutboundMessage(
        'events.handler',
        userId,
        `⚠️ **Recursion Limit Exceeded**\n\nI have detected an infinite loop between agents (Depth: ${currentDepth}). I've intervened to stop the process. Please check the orchestration logic. You can increase this limit in the System Config.`,
        undefined,
        sessionId,
        'SuperClaw'
      );
      return;
    }

    // 2. Dynamic Routing
    // If the initiator is not the main agent, we route back to that specific agent
    const resultPrefix = isFailure ? 'DELEGATED_TASK_FAILURE' : 'DELEGATED_TASK_RESULT';

    await wakeupInitiator(
      userId,
      initiatorId || 'main',
      `${resultPrefix}: Agent '${agentId}' has ${isFailure ? 'failed' : 'completed'} the task: "${task}". 
      ${isFailure ? 'Error' : 'Result'}:
      ---
      ${response}
      ---
      Please continue your logic based on this result.`,
      traceId,
      sessionId,
      currentDepth
    );
  }
};
