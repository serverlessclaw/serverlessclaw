import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { EventType, TraceSource, SSTResource } from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { Resource } from 'sst';
import { SYSTEM, DYNAMO_KEYS } from '../lib/constants';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const typedResource = Resource as unknown as SSTResource;

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
      traceId: incomingTraceId,
      sessionId,
    } = event.detail as {
      userId: string;
      buildId?: string;
      errorLogs?: string;
      traceId?: string;
      sessionId?: string;
    };

    const task = `CRITICAL: Deployment ${buildId} failed. 
    Here are the last few lines of the logs:
    ---
    ${errorLogs}
    ---
    Please investigate the codebase, find the root cause, fix the issue, and trigger a new deployment. 
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
      traceId: incomingTraceId,
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
  } else if (event['detail-type'] === EventType.SYSTEM_BUILD_SUCCESS) {
    const { userId, buildId, sessionId } = event.detail as {
      userId: string;
      buildId?: string;
      sessionId?: string;
    };

    const message = `✅ **DEPLOYMENT SUCCESSFUL**
Build ID: ${buildId}

The system has successfully evolved and all planned gaps have been marked as DONE. 
I am ready for further tasks or instructions.`;

    await sendOutboundMessage('events.handler', userId, message, undefined, sessionId, 'SuperClaw');
  } else if (event['detail-type'] === EventType.CONTINUATION_TASK) {
    const { userId, agentId, task, traceId, sessionId } = event.detail as {
      userId: string;
      agentId?: string;
      task: string;
      traceId: string;
      sessionId?: string;
    };

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
      isContinuation: true,
      traceId,
      sessionId,
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
  } else if (event['detail-type'] === EventType.TASK_COMPLETED) {
    const { userId, agentId, task, response, traceId, initiatorId, depth, sessionId } =
      event.detail as {
        userId: string;
        agentId: string;
        task: string;
        response: string;
        traceId: string;
        initiatorId?: string;
        depth?: number;
        sessionId?: string;
      };

    const currentDepth = depth || 1;
    logger.info(
      `Relaying completion from ${agentId} to Initiator: ${initiatorId || 'Orchestrator'} (Depth: ${currentDepth}, Session: ${sessionId})`
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
    const initiatorAgentId =
      initiatorId && initiatorId.endsWith('.agent')
        ? initiatorId.replace('.agent', '')
        : initiatorId || 'main';

    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({});

    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'events.handler',
            DetailType: EventType.CONTINUATION_TASK,
            Detail: JSON.stringify({
              userId,
              agentId: initiatorAgentId,
              task: `DELEGATED_TASK_RESULT: Agent '${agentId}' has completed the task: "${task}". 
              Result:
              ---
              ${response}
              ---
              Please continue your logic based on this result.`,
              traceId,
              initiatorId,
              depth: currentDepth,
              sessionId,
            }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  }
};
