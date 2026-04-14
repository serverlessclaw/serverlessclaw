import { TASK_EVENT_SCHEMA } from '../../lib/schema/events';
import { AgentType } from '../../lib/types/index';
import { logger } from '../../lib/logger';
import { Context } from 'aws-lambda';
import { handleRecursionLimitExceeded, processEventWithAgent } from './shared';
import { getRecursionLimit } from '../../lib/recursion-tracker';

/**
 * Handles continuation task events - resumes agent processing with context.
 *
 * @param eventDetail - The task event detail containing the agentId, task, and context.
 * @param context - The AWS Lambda context.
 */
export async function handleContinuationTask(
  eventDetail: Record<string, unknown>,
  context: Context
): Promise<void> {
  const {
    userId,
    agentId,
    task,
    traceId,
    sessionId,
    depth,
    initiatorId,
    attachments,
    tokenBudget,
    costLimit,
    metadata,
  } = TASK_EVENT_SCHEMA.parse(eventDetail);

  const currentDepth = depth ?? 1;

  // 1. Loop Protection - Check recursion depth before processing
  // Boundary: Depth 1 is the first level. If limit is 15, allow depths 1-14, block at 15+.
  // This uses >= for safety: at depth 15 with limit 15, we stop to prevent runaway recursion.
  const RECURSION_LIMIT = await getRecursionLimit();

  if (currentDepth >= RECURSION_LIMIT) {
    logger.error(
      `Recursion Limit Exceeded for CONTINUATION_TASK (Depth: ${currentDepth}) for user ${userId}. Aborting.`
    );
    await handleRecursionLimitExceeded(
      userId,
      sessionId,
      'continuation-handler',
      `I have detected an infinite loop in task continuation (Depth: ${currentDepth}). I've intervened to stop the process. Please check the orchestration logic.`,
      traceId,
      agentId ?? 'superclaw'
    );
    return;
  }

  const priorTokenUsage = metadata?.priorTotalTokens
    ? {
        inputTokens: ((metadata as Record<string, unknown>).priorInputTokens as number) ?? 0,
        outputTokens: ((metadata as Record<string, unknown>).priorOutputTokens as number) ?? 0,
        totalTokens: ((metadata as Record<string, unknown>).priorTotalTokens as number) ?? 0,
      }
    : undefined;

  const targetAgentId = agentId ?? AgentType.SUPERCLAW;
  logger.info(`Handling continuation task for agent ${targetAgentId}, user:`, userId, {
    traceId,
    sessionId,
    priorTokens: priorTokenUsage?.totalTokens ?? 0,
  });

  await processEventWithAgent(userId, targetAgentId, task, {
    context,
    isContinuation: true,
    traceId,
    sessionId,
    depth,
    initiatorId,
    attachments: attachments as import('../../lib/types/index').Attachment[],
    tokenBudget,
    costLimit,
    priorTokenUsage,
    handlerTitle: 'CONTINUATION_NOTIFICATION',
    outboundHandlerName: 'continuation-handler',
  });
}
