/**
 * Escalation Level Timeout Handler
 * Handles escalation level timeout events from the scheduler
 */

import { z } from 'zod';
import { logger } from '../../lib/logger';
import { escalationManager } from '../../lib/lifecycle/escalation-manager';

/**
 * Schema for escalation level timeout event detail.
 */
const ESCALATION_TIMEOUT_SCHEMA = z.object({
  traceId: z.string(),
  agentId: z.string(),
  userId: z.string(),
  question: z.string().optional(),
  originalTask: z.string().optional(),
  currentLevel: z.number(),
  policyId: z.string(),
});

/**
 * Handles escalation level timeout events
 *
 * @param eventDetail - The event detail containing escalation state
 */
export async function handleEscalationLevelTimeout(
  eventDetail: Record<string, unknown>
): Promise<void> {
  let validated;
  try {
    validated = ESCALATION_TIMEOUT_SCHEMA.parse(eventDetail);
  } catch (error) {
    logger.error('Invalid escalation level timeout event detail:', error);
    return;
  }

  const { traceId, agentId, question, originalTask, currentLevel, policyId } = validated;

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
