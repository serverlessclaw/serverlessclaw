import { GapStatus, AgentType, EvolutionMode, AgentEvent, AgentPayload } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  initAgent,
  extractBaseUserId,
  detectFailure,
} from '../lib/utils/agent-helpers';
import { sendOutboundMessage } from '../lib/outbound';

/**
 * QA Agent handler. Triggered after a build success or coder task completion.
 *
 * @param event - The EventBridge event containing task and implementation details.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves when the audit is complete.
 */
export const handler = async (event: AgentEvent, _context: Context): Promise<void> => {
  logger.info('QA Agent received verification task:', JSON.stringify(event, null, 2));

  const payload = extractPayload<AgentPayload>(event);
  const {
    userId,
    response: implementationResponse,
    traceId,
    sessionId,
    initiatorId,
    depth,
  } = payload;
  const gapIds = payload.metadata?.gapIds as string[];

  if (!userId || !gapIds || !Array.isArray(gapIds) || gapIds.length === 0) {
    logger.warn('QA Auditor received incomplete payload, skipping verification.');
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // 0. Discovery & Initialization
  const { config, memory } = await initAgent(AgentType.QA);

  // 1. Process QA Audit via unified lifecycle (Session Locking + Heartbeat)
  const { processEventWithAgent } = await import('../handlers/events/shared');

  const qaPrompt = `Verify and audit the following gaps: ${gapIds.join(', ')}\n\nImplementation Output:\n${implementationResponse || 'No implementation response provided.'}`;

  let auditReport: string;
  let parsedData: any;
  try {
    const result = await processEventWithAgent(userId, AgentType.QA, qaPrompt, {
      context: _context,
      traceId,
      taskId: traceId,
      sessionId,
      depth,
      initiatorId,
      isContinuation: true,
      handlerTitle: 'QA Auditor',
      outboundHandlerName: AgentType.QA,
      formatResponse: (text) => text,
    });
    auditReport = result.responseText;
    parsedData = result.parsedData;
  } catch (err) {
    logger.error('Unexpected error in QA Agent processing:', err);
    return; // Failure handled by wrapper
  }

  // 2. Evolution Management (Post-Audit Logic)
  // Check both raw text (for backward compatibility) and parsed status
  const isSatisfied =
    parsedData?.status === 'SUCCESS' ||
    parsedData?.satisfied === true ||
    (!detectFailure(auditReport) &&
      auditReport.toLowerCase().includes('satisfied') &&
      !auditReport.toLowerCase().includes('"satisfied": false'));

  // Resolve evolution mode
  let evolutionMode = EvolutionMode.HITL;
  try {
    const { AgentRegistry } = await import('../lib/registry');
    const mode = await AgentRegistry.getRawConfig('evolution_mode');
    if (mode === EvolutionMode.AUTO) evolutionMode = EvolutionMode.AUTO;
  } catch {
    logger.warn('Failed to fetch evolution_mode, defaulting to HITL.');
  }

  if (isSatisfied) {
    // Record success and increment trust score
    if (initiatorId) {
      try {
        const { SafetyEngine } = await import('../lib/safety/safety-engine');
        const safety = new SafetyEngine();
        // Sh6: Pass the numeric score from the judge to reward high-quality work
        await safety.recordSuccess(initiatorId, (parsedData as any)?.score);
      } catch (e) {
        logger.warn(`Failed to record trust success for ${initiatorId}:`, e);
      }
    }

    if (evolutionMode === EvolutionMode.AUTO) {
      logger.info('Verification successful. Auto-closing gaps.');
      for (const gapId of gapIds) {
        const lockAcquired = await memory.acquireGapLock(gapId, AgentType.QA);
        if (lockAcquired) {
          try {
            await memory.updateGapStatus(gapId, GapStatus.DONE);
          } finally {
            await memory.releaseGapLock(gapId, AgentType.QA);
          }
        }
      }
    } else {
      logger.info('Verification successful. Awaiting human confirmation (HITL).');
      for (const gapId of gapIds) {
        const lockAcquired = await memory.acquireGapLock(gapId, AgentType.QA);
        if (lockAcquired) {
          try {
            await memory.updateGapStatus(gapId, GapStatus.PENDING_APPROVAL, undefined, {
              sessionId,
              requestingUserId: userId,
            });
          } finally {
            await memory.releaseGapLock(gapId, AgentType.QA);
          }
        }
      }

      await sendOutboundMessage(
        AgentType.QA,
        userId,
        `✅ **Verification Passed for Gaps: ${gapIds.join(', ')}**\n\nThe implementation has passed QA verification. Please confirm to complete the evolution.\n\n**Action Required:** Reply with "APPROVE" to close these gaps, or "REJECT" to reopen them for revision.`,
        [baseUserId],
        sessionId,
        config.name
      );
    }
  } else {
    // Record failure and penalize trust score
    if (initiatorId) {
      try {
        const { SafetyEngine } = await import('../lib/safety/safety-engine');
        const safety = new SafetyEngine();
        await safety.recordFailure(
          initiatorId,
          `QA Verification Failed: ${auditReport.substring(0, 150)}`
        );
      } catch (e) {
        logger.warn(`Failed to record trust penalty for ${initiatorId}:`, e);
      }
    }

    const retryGaps: string[] = [];

    for (const gapId of gapIds) {
      const lockAcquired = await memory.acquireGapLock(gapId, AgentType.QA);
      if (lockAcquired) {
        try {
          const attempts = await memory.incrementGapAttemptCount(gapId);
          if (attempts >= 3) {
            await memory.updateGapStatus(gapId, GapStatus.FAILED);
          } else {
            await memory.updateGapStatus(gapId, GapStatus.OPEN);
            retryGaps.push(gapId);
          }
        } finally {
          await memory.releaseGapLock(gapId, AgentType.QA);
        }
      }
    }

    if (retryGaps.length > 0 && initiatorId) {
      const { wakeupInitiator } = await import('../handlers/events/shared');
      await wakeupInitiator(
        baseUserId,
        initiatorId,
        `QA_VERIFICATION_FAILED: The changes for gaps ${retryGaps.join(', ')} failed verification.\n\nAudit Report:\n${auditReport}\n\n⚠️ TDD MANDATE: Before attempting another fix, you MUST first write a failing regression test.`,
        traceId,
        sessionId,
        depth
      );
    }
  }
};
