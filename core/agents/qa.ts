import { ReasoningProfile } from '../lib/types/llm';
import {
  GapStatus,
  AgentStatus,
  AgentType,
  EvolutionMode,
  TraceSource,
  AgentEvent,
  AgentPayload,
} from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { extractPayload, initAgent, extractBaseUserId } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { sendOutboundMessage } from '../lib/outbound';
import { QA_SYSTEM_PROMPT } from './prompts';

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

  // 1. Discovery & Initialization
  const { config, memory } = await initAgent(AgentType.QA);
  const { LLMJudge } = await import('../lib/verify/judge');

  // Perform semantic evaluation using LLM-as-a-Judge
  const judgeResult = await LLMJudge.evaluate(
    `Verify and audit the following gaps: ${gapIds.join(', ')}`,
    implementationResponse || 'No implementation response provided.',
    [
      'The code matches the architectural spirit of Serverless Claw (Stateless, AI-Native, Event-Driven).',
      'The implementation actually solves the identified gaps.',
      'No new security risks or technical debt were introduced.',
      'Code is idiomatically complete and follows system-wide conventions.'
    ],
    { gapIds, traceId, sessionId }
  );

  logger.info('LLM-as-a-Judge Result:', JSON.stringify(judgeResult, null, 2));

  let status = judgeResult.satisfied ? AgentStatus.SUCCESS : AgentStatus.REOPEN;
  let auditReport = judgeResult.reasoning;
  let validatedFeedback: import('../lib/schema/orchestration').QAFailureFeedback | null = null;

  if (status === AgentStatus.REOPEN && judgeResult.issues && judgeResult.issues.length > 0) {
    // Attempt to map issues to structured feedback format if possible
    validatedFeedback = {
      failureType: 'LOGIC_ERROR',
      issues: judgeResult.issues.map(issue => ({
        file: 'multiple',
        line: 0,
        description: issue,
        expected: 'Requirement satisfied',
        actual: 'Requirement failed'
      }))
    };
  }

  const isSatisfied = status === AgentStatus.SUCCESS;

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
    if (evolutionMode === EvolutionMode.AUTO) {
      logger.info('Verification successful. Auto-closing gaps.');
      const { EVOLUTION_METRICS } = await import('../lib/metrics/evolution-metrics');

      for (const gapId of gapIds) {
        // DEPLOYED -> DONE: Acquire lock before transition
        const lockAcquired = await memory.acquireGapLock(gapId, AgentType.QA);
        if (!lockAcquired) {
          logger.warn(`[QA] Could not acquire lock for gap ${gapId}, skipping transition to DONE.`);
          EVOLUTION_METRICS.recordLockContention(gapId, AgentType.QA);
          continue;
        }

        try {
          const result = await memory.updateGapStatus(gapId, GapStatus.DONE);
          if (!result.success) {
            logger.warn(`[QA] Failed to transition gap ${gapId} to DONE: ${result.error}`);
            EVOLUTION_METRICS.recordTransitionRejection(
              gapId,
              GapStatus.DEPLOYED,
              GapStatus.DONE,
              result.error || 'unknown'
            );
          }
        } finally {
          await memory.releaseGapLock(gapId, AgentType.QA);
        }
      }
    } else {
      // HITL mode: Transition gaps to PENDING_APPROVAL and notify user
      logger.info('Verification successful. Awaiting human confirmation (HITL).');
      const { EVOLUTION_METRICS } = await import('../lib/metrics/evolution-metrics');

      for (const gapId of gapIds) {
        const lockAcquired = await memory.acquireGapLock(gapId, AgentType.QA);
        if (!lockAcquired) {
          logger.warn(
            `[QA] Could not acquire lock for gap ${gapId}, skipping transition to PENDING_APPROVAL.`
          );
          EVOLUTION_METRICS.recordLockContention(gapId, AgentType.QA);
          continue;
        }

        try {
          const result = await memory.updateGapStatus(gapId, GapStatus.PENDING_APPROVAL);
          if (!result.success) {
            logger.warn(
              `[QA] Failed to transition gap ${gapId} to PENDING_APPROVAL: ${result.error}`
            );
            EVOLUTION_METRICS.recordTransitionRejection(
              gapId,
              GapStatus.DEPLOYED,
              GapStatus.PENDING_APPROVAL,
              result.error || 'unknown'
            );
          }
        } finally {
          await memory.releaseGapLock(gapId, AgentType.QA);
        }
      }

      // Send confirmation request to user
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
    // Reopen failed verification. Track attempt count and escalate to FAILED if cap reached.
    const MAX_REOPEN_ATTEMPTS = 3;
    logger.warn('Verification failed. Checking reopen attempt counts.');
    const { EVOLUTION_METRICS } = await import('../lib/metrics/evolution-metrics');

    const results: Array<{ gapId: string; status: 'escalated' | 'retry' | 'skipped' }> = [];

    for (const gapId of gapIds) {
      // DEPLOYED -> OPEN/FAILED: Acquire lock before transition
      const lockAcquired = await memory.acquireGapLock(gapId, AgentType.QA);
      if (!lockAcquired) {
        logger.warn(`[QA] Could not acquire lock for gap ${gapId}, skipping failure transition.`);
        EVOLUTION_METRICS.recordLockContention(gapId, AgentType.QA);
        results.push({ gapId, status: 'skipped' });
        continue;
      }

      try {
        const attempts = await memory.incrementGapAttemptCount(gapId);
        if (attempts >= MAX_REOPEN_ATTEMPTS) {
          logger.warn(`Gap ${gapId} has been reopened ${attempts} times. Escalating to FAILED.`);
          const result = await memory.updateGapStatus(gapId, GapStatus.FAILED);
          if (!result.success) {
            logger.warn(`[QA] Failed to transition gap ${gapId} to FAILED: ${result.error}`);
            EVOLUTION_METRICS.recordTransitionRejection(
              gapId,
              GapStatus.DEPLOYED,
              GapStatus.FAILED,
              result.error || 'unknown'
            );
          }
          results.push({ gapId, status: 'escalated' });
        } else {
          logger.info(`Gap ${gapId} reopen attempt ${attempts}/${MAX_REOPEN_ATTEMPTS}.`);
          EVOLUTION_METRICS.recordGapReopen(gapId, attempts);
          const result = await memory.updateGapStatus(gapId, GapStatus.OPEN);
          if (!result.success) {
            logger.warn(`[QA] Failed to transition gap ${gapId} to OPEN: ${result.error}`);
            EVOLUTION_METRICS.recordTransitionRejection(
              gapId,
              GapStatus.DEPLOYED,
              GapStatus.OPEN,
              result.error || 'unknown'
            );
          }
          results.push({ gapId, status: 'retry' });
        }
      } finally {
        await memory.releaseGapLock(gapId, AgentType.QA);
      }
    }

    const escalatedGaps = results.filter((r) => r.status === 'escalated').map((r) => r.gapId);
    const retryGaps = results.filter((r) => r.status === 'retry').map((r) => r.gapId);

    if (escalatedGaps.length > 0) {
      await sendOutboundMessage(
        AgentType.QA,
        userId,
        `⚠️ **Evolution Escalation Required**\n\nGaps ${escalatedGaps.join(', ')} have failed QA verification ${MAX_REOPEN_ATTEMPTS} times and cannot be autonomously resolved.\n\nPlease review the implementation manually and re-approve when ready.`,
        [baseUserId],
        sessionId,
        config.name
      );
    }

    // GAP #2 FIX: Record failed plan as anti-pattern for the swarm to learn from
    try {
      const planHash = `qa-reject-${gapIds.join('-')}-${Date.now()}`;
      await memory.recordFailedPlan(
        planHash,
        implementationResponse || 'No implementation response provided',
        gapIds,
        `QA_REJECTED: ${auditReport.substring(0, 300)}`
      );
      logger.info(`Recorded failed plan for gaps ${gapIds.join(', ')} in negative memory.`);
    } catch (e) {
      logger.warn('Failed to record failed plan in negative memory:', e);
    }

    // Notify Initiator about the failure so they can decide on the next course of action
    const feedbackContext = validatedFeedback
      ? `\n\nStructured Feedback (${validatedFeedback.failureType}):\n${validatedFeedback.issues.map((i) => `- ${i.file}:${i.line} - ${i.description}`).join('\n')}`
      : '';
    if (initiatorId) {
      const { wakeupInitiator } = await import('../handlers/events/shared');
      await wakeupInitiator(
        baseUserId,
        initiatorId,
        `QA_VERIFICATION_FAILED: The changes for gaps ${retryGaps.join(', ')} failed verification.\n\nAudit Report:\n${auditReport}${feedbackContext}\n\n⚠️ TDD MANDATE: Before attempting another fix, you MUST first write a failing regression test that reproduces this specific QA failure. Then, fix the code to make the test pass.`,
        traceId,
        sessionId,
        depth
      );
    } else {
      // Fallback: direct dispatch to coder if no initiator
      const { TOOLS } = await import('../tools/index');
      const dispatcher = TOOLS.dispatchTask;
      await dispatcher.execute({
        agentId: AgentType.CODER,
        userId: baseUserId,
        task: `QA verification failed for gaps: ${retryGaps.join(', ')}.\n\nAudit Report:\n${auditReport}${feedbackContext}\n\n⚠️ TDD MANDATE: Before attempting another fix, you MUST first write a failing regression test that reproduces this specific QA failure. Only after the test fails should you implement the fix and redeploy.`,
        metadata: { gapIds: retryGaps },
        traceId,
        sessionId,
        initiatorId: AgentType.QA,
        depth: (depth ?? 0) + 1,
      });
    }
  }

  // 1. Notify user directly in the chat session
  await sendOutboundMessage(
    AgentType.QA,
    userId,
    `🔍 **QA Audit Complete**\n\n${auditReport}`,
    [baseUserId],
    sessionId,
    config.name,
    resultAttachments
  );

  // 2. Universal Coordination: Notify Initiator (if any)
  await emitTaskEvent({
    source: AgentType.QA,
    agentId: AgentType.QA,
    userId: baseUserId,
    task: `Audit gaps: ${gapIds.join(', ')}`,
    response: auditReport,
    attachments: resultAttachments,
    traceId,
    sessionId,
    initiatorId,
    depth,
  });
};
