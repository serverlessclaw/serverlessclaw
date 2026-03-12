import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { EventType } from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';

const memory = new DynamoMemory();
const provider = new ProviderManager();

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

  const { userId, buildId, errorLogs } = event.detail as {
    userId: string;
    buildId?: string;
    errorLogs?: string;
  };

  if (event['detail-type'] === EventType.SYSTEM_BUILD_FAILED) {
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
    });

    // Notify user via Notifier (if not paused)
    if (!responseText.startsWith('TASK_PAUSED')) {
      await sendOutboundMessage('events.handler', userId, responseText);
    }
  } else if (event['detail-type'] === EventType.SYSTEM_BUILD_SUCCESS) {
    const message = `✅ **DEPLOYMENT SUCCESSFUL**
Build ID: ${buildId}

The system has successfully evolved and all planned gaps have been marked as DONE. 
I am ready for further tasks or instructions.`;

    await sendOutboundMessage('events.handler', userId, message);
  } else if (event['detail-type'] === EventType.CONTINUATION_TASK) {
    const { userId, task, traceId } = event.detail as {
      userId: string;
      task: string;
      traceId: string;
    };

    logger.info('Handling continuation task for user:', userId, { traceId });

    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig('main');
    if (!config) return;

    const agentTools = await getAgentTools('events');
    const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

    // Resume with isContinuation = true
    const responseText = await agent.process(userId, task, {
      context,
      isContinuation: true,
    });

    if (!responseText.startsWith('TASK_PAUSED')) {
      await sendOutboundMessage('events.handler', userId, responseText);
    }
  } else if (event['detail-type'] === EventType.TASK_COMPLETED) {
    const { userId, agentId, task, response, traceId } = event.detail as {
      userId: string;
      agentId: string;
      task: string;
      response: string;
      traceId: string;
    };

    logger.info(`Relaying completion from ${agentId} to Orchestrator (User: ${userId})`);

    // Signal SuperClaw to resume with the delegated task result
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const { Resource } = await import('sst');
    const eb = new EventBridgeClient({});

    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'events.handler',
            DetailType: EventType.CONTINUATION_TASK,
            Detail: JSON.stringify({
              userId,
              task: `DELEGATED_TASK_RESULT: Agent '${agentId}' has completed the task: "${task}". 
              Result:
              ---
              ${response}
              ---
              Please continue your orchestration loop based on this result.`,
              traceId,
            }),
            EventBusName: (Resource as any).AgentBus.name,
          },
        ],
      })
    );
  }
};
