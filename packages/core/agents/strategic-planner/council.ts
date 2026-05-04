import { logger } from '../../lib/logger';
import { AGENT_TYPES, EvolutionMode } from '../../lib/types/agent';
import { sendOutboundMessage } from '../../lib/outbound';
import { TRACE_TYPES } from '../../lib/constants';
import { getEvolutionMode } from './evolution';
import { IMemory } from '../../lib/types/memory';
import { PlannerResult } from './types';

/**
 * Handles the result of a Council of Agents review.
 *
 * @param task - The synthesized review results/verdict.
 * @param traceId - The trace ID of the council review.
 * @param memory - The memory provider instance.
 * @param baseUserId - The normalized user ID.
 * @param originalUserId - The original user ID (e.g. with prefixes).
 * @param config - The agent configuration.
 * @returns A promise resolving to a PlannerResult or null if not a council result.
 */
export async function handleCouncilReviewResult(
  task: string,
  traceId: string,
  memory: IMemory,
  userId: string,
  config: { name: string }
): Promise<PlannerResult | null> {
  const { extractBaseUserId } = await import('../../lib/utils/agent-helpers');
  const baseUserId = extractBaseUserId(userId);
  // P1 Fix: More robust VERDICT parsing with case-insensitive regex
  const councilReviewPattern = /\[COUNCIL_REVIEW_RESULT\]/i;
  const verdictApprovedPattern = /VERDICT:\s*APPROVED/i;
  const verdictRejectedPattern = /VERDICT:\s*REJECTED/i;
  const verdictConditionalPattern = /VERDICT:\s*CONDITIONAL/i;

  if (
    !councilReviewPattern.test(task) &&
    !verdictApprovedPattern.test(task) &&
    !verdictRejectedPattern.test(task)
  ) {
    return null;
  }

  logger.info(`[PLANNER] Detected Council review result for trace ${traceId}`);

  // Trace: Council review results being processed
  const { addTraceStep } = await import('../../lib/utils/trace-helper');
  const verdict = verdictApprovedPattern.test(task)
    ? 'APPROVED'
    : verdictRejectedPattern.test(task)
      ? 'REJECTED'
      : verdictConditionalPattern.test(task)
        ? 'CONDITIONAL'
        : 'UNKNOWN';
  await addTraceStep(traceId, 'root', {
    type: TRACE_TYPES.COUNCIL_REVIEW,
    content: {
      verdict,
      summary: task,
      initiatorId: AGENT_TYPES.STRATEGIC_PLANNER,
    },
    metadata: { event: 'council_review_processed', traceId },
  });

  // The traceId here will be the unique councilTraceId we used during dispatch
  const councilDataStr = await memory.getDistilledMemory(`TEMP#COUNCIL_PLAN#${traceId}`);
  if (!councilDataStr) {
    logger.warn(
      `[PLANNER] Received Council review result but could not find original plan for trace ${traceId}`
    );
    return null;
  }

  const {
    plan: originalPlan,
    gapIds,
    sessionId: originalSessionId,
    planId: originalPlanId,
    collaborationId: councilCollabId,
    userId: originalUserId,
  } = JSON.parse(councilDataStr);

  // P1 Fix: Use consistent robust pattern for verdict detection
  const isApproved = verdictApprovedPattern.test(task) || /APPROVED/i.test(task);
  const isConditional = verdictConditionalPattern.test(task) || /CONDITIONAL/i.test(task);

  // Close the Council collaboration session
  if (councilCollabId) {
    try {
      await memory.closeCollaboration(councilCollabId, baseUserId, 'agent');
      logger.info(`[PLANNER] Closed Council collaboration ${councilCollabId}`);
    } catch (e) {
      logger.warn(`[PLANNER] Failed to close collaboration ${councilCollabId}:`, e);
    }
  }

  if (isApproved || isConditional) {
    logger.info(
      `[PLANNER] Council ${isApproved ? 'APPROVED' : 'CONDITIONALLY APPROVED'} plan for trace ${traceId}. Checking evolution mode.`
    );

    const evolutionMode = await getEvolutionMode();

    if (evolutionMode === EvolutionMode.AUTO) {
      logger.info('[PLANNER] Evolution mode is auto, dispatching CODER_TASK.');
      await sendOutboundMessage(
        AGENT_TYPES.STRATEGIC_PLANNER,
        originalUserId,
        `✅ **Council Approval Received**\n\nThe Council of Agents has ${isApproved ? 'approved' : 'conditionally approved'} the plan. Dispatching to Coder Agent for execution.\n\nSummary of Review:\n${task}`,
        undefined,
        originalSessionId,
        config.name
      );

      const { dispatchTask: dispatcher } = await import('../../tools/knowledge/agent');
      await dispatcher.execute({
        agentId: AGENT_TYPES.CODER,
        userId: baseUserId,
        task: originalPlan,
        metadata: { gapIds },
        traceId,
        sessionId: originalSessionId,
      });
    } else {
      logger.info('[PLANNER] Evolution mode is hitl, asking for human approval.');
      await sendOutboundMessage(
        AGENT_TYPES.STRATEGIC_PLANNER,
        originalUserId,
        `✅ **Council Approval Received**\n\nThe Council of Agents has approved the plan with findings:\n\n${task}\n\nDo you want to execute the original plan?\n\nPlan:\n${originalPlan}`,
        undefined,
        originalSessionId,
        config.name,
        undefined,
        undefined,
        [
          { label: 'Approve', value: `APPROVE ${originalPlanId || traceId}` },
          { label: 'Clarify', value: `CLARIFY ${originalPlanId || traceId}` },
          {
            label: 'Dismiss',
            value: `DISMISS ${originalPlanId || traceId}`,
            type: 'secondary' as const,
          },
        ]
      );
    }
  } else {
    logger.warn(`[PLANNER] Council REJECTED plan for trace ${traceId}. Informing user.`);
    await sendOutboundMessage(
      AGENT_TYPES.STRATEGIC_PLANNER,
      userId,
      `❌ **Council Review REJECTED**\n\nThe Council has rejected the strategic plan. Implementation has been blocked for safety. Please review the findings and revise the strategy.\n\nFeedback:\n${task}`,
      undefined,
      originalSessionId,
      config.name
    );
  }

  return {
    status: isApproved || isConditional ? 'COUNCIL_APPROVED' : 'COUNCIL_REJECTED',
    plan: originalPlan,
  };
}
