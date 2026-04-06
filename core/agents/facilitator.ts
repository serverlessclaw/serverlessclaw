import { AgentType, AgentEvent, AgentPayload } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { extractPayload, extractBaseUserId, validatePayload } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { processEventWithAgent } from '../handlers/events/shared';

/**
 * Facilitator Agent Handler.
 * Dedicated moderator for Multi-Party Collaboration sessions.
 * Manages consensus building, conflict resolution, and session transitions.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the agent's response string, or undefined on error.
 */
export const handler = async (event: AgentEvent, context: Context): Promise<string | undefined> => {
  logger.info('Facilitator Agent received task:', JSON.stringify(event, null, 2));

  const payload = extractPayload<AgentPayload>(event);
  const { userId, task, traceId, sessionId, initiatorId, depth, attachments } = payload;

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  try {
    const { responseText } = await processEventWithAgent(
      userId,
      AgentType.FACILITATOR,
      task || '',
      {
        context,
        traceId,
        taskId: payload.taskId,
        sessionId,
        initiatorId,
        depth,
        attachments,
        handlerTitle: 'FACILITATOR_TASK',
        outboundHandlerName: 'facilitator-handler',
      }
    );

    // Notification is already handled inside processEventWithAgent for TaskEvent
    // but we return the response for compatibility with Agent Runner and direct calls.
    return responseText;
  } catch (error) {
    logger.error(`[FACILITATOR] Task failed:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    await emitTaskEvent({
      source: `${AgentType.FACILITATOR}.agent`,
      agentId: AgentType.FACILITATOR,
      userId: baseUserId,
      task: task || '',
      error: `Facilitator task failed: ${errorMsg}`,
      traceId,
      taskId: payload.taskId,
      sessionId,
      initiatorId,
      depth,
    });

    throw error;
  }
};
