/**
 * Escalation Level Timeout Handler
 * Handles escalation level timeout events from the scheduler
 */

import { logger } from '../../lib/logger';
import { escalationManager } from '../../lib/lifecycle/escalation-manager';

/**
 * Handles escalation level timeout events
 *
 * @param eventDetail - The event detail containing escalation state
 */
export async function handleEscalationLevelTimeout(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const { traceId, agentId, question, originalTask, currentLevel, policyId } =
    eventDetail as unknown as {
      traceId: string;
      agentId: string;
      userId: string;
      question?: string;
      originalTask?: string;
      currentLevel: number;
      policyId: string;
    };

  logger.info(
    `Handling escalation level timeout: traceId=${traceId}, agentId=${agentId}, ` +
      `level=${currentLevel}, policy=${policyId}`
  );

  try {
    // Get the escalation state to retrieve question and originalTask if not provided
    const state = await escalationManager.getEscalationState(traceId, agentId);

    if (!state) {
      logger.warn(`No escalation state found for ${traceId}/${agentId}`);
      return;
    }

    if (state.completed) {
      logger.info(`Escalation already completed for ${traceId}/${agentId}`);
      return;
    }

    // Use provided question/task or retrieve from state
    const effectiveQuestion = question ?? 'No question provided';
    const effectiveTask = originalTask ?? 'No task provided';

    // Handle the level timeout
    await escalationManager.handleLevelTimeout(traceId, agentId, effectiveQuestion, effectiveTask);

    logger.info(`Successfully handled escalation level timeout for ${traceId}/${agentId}`);
  } catch (error) {
    logger.error(`Failed to handle escalation level timeout for ${traceId}/${agentId}:`, error);
  }
}
