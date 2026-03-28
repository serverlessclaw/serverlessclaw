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
import {
  extractPayload,
  loadAgentConfig,
  getAgentContext,
  extractBaseUserId,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
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

  // 1. Discovery & Initialization
  const config = await loadAgentConfig(AgentType.QA);
  const { memory, provider: providerManager } = await getAgentContext();

  const { getAgentTools } = await import('../tools/index');
  const agentTools = await getAgentTools('qa');
  const { Agent } = await import('../lib/agent');
  const qaAgent = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);

  // GAP #3 FIX: Mandatory mechanical verification — tool calls are enforced before verdict
  const auditPrompt = `You are a strict QA auditor. Your job is to INDEPENDENTLY verify that code changes are correct and live. You MUST NOT trust the Coder's self-report.

    ╔══════════════════════════════════════════════════════════════╗
    ║  STEP 1 — MANDATORY MECHANICAL VERIFICATION (NON-NEGOTIABLE) ║
    ╚══════════════════════════════════════════════════════════════╝
    
    Before you form ANY verdict, you MUST call at least TWO of these tools:
    
    1. 'validateCode' — Run this FIRST to check for type errors and compilation issues.
    2. 'read_file' or 'filesystem_read_file' — Read the actual files that were claimed to be modified.
    3. 'checkHealth' — Verify the live system is healthy (especially if the change affects endpoints).
    4. 'runTests' — Run the test suite to verify no regressions.
    
    ⚠️  IF YOU DO NOT CALL ANY VERIFICATION TOOLS, YOUR VERDICT IS AUTOMATICALLY REOPEN_REQUIRED.
    
    ╔══════════════════════════════════════════════════════════════╗
    ║  STEP 2 — VERDICT (after mechanical checks)                  ║
    ╚══════════════════════════════════════════════════════════════╝
    
    Only AFTER your tool checks complete, respond with a JSON verdict:
    { "status": "SUCCESS", "auditReport": "..." } or { "status": "REOPEN", "auditReport": "..." }
    
    The verdict MUST reference specific tool outputs as evidence.
    
    ╔══════════════════════════════════════════════════════════════╗
    ║  STEP 3 — SYNC (only if verification passes)                 ║
    ╚══════════════════════════════════════════════════════════════╝
    
    If verification passes, you MUST call 'triggerTrunkSync' to finalize the trunk sync.
    
    Background (Coder's self-report — treat as UNVERIFIED):
    ${implementationResponse}

    Target Gaps:
    ${gapIds.join(', ')}`;

  const { responseText: rawResponse, attachments: resultAttachments } = await qaAgent.process(
    userId,
    auditPrompt,
    {
      profile: ReasoningProfile.THINKING,
      isIsolated: true,
      source: TraceSource.DASHBOARD,
      initiatorId,
      depth,
      traceId,
      sessionId,
    }
  );

  logger.info('QA Agent Raw Response:', rawResponse);

  let status = AgentStatus.REOPEN;
  let auditReport = rawResponse;

  try {
    const jsonContent = rawResponse.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonContent);
    status = parsed.status === AgentStatus.SUCCESS ? AgentStatus.SUCCESS : AgentStatus.REOPEN;
    auditReport = parsed.auditReport || rawResponse;
    logger.info(`Parsed QA Result. Status: ${status}`);
  } catch (e) {
    logger.warn('Failed to parse QA structured response, falling back to raw text.', e);
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
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DONE);
      }
    } else {
      logger.info('Verification successful. Awaiting human confirmation (HITL).');
    }
  } else {
    // Reopen failed verification. Track attempt count and escalate to FAILED if cap reached.
    const MAX_REOPEN_ATTEMPTS = 3;
    logger.warn('Verification failed. Checking reopen attempt counts.');
    const escalatedGaps: string[] = [];
    const retryGaps: string[] = [];

    for (const gapId of gapIds) {
      const attempts = await memory.incrementGapAttemptCount(gapId);
      if (attempts >= MAX_REOPEN_ATTEMPTS) {
        logger.warn(`Gap ${gapId} has been reopened ${attempts} times. Escalating to FAILED.`);
        await memory.updateGapStatus(gapId, GapStatus.FAILED);
        escalatedGaps.push(gapId);
      } else {
        logger.info(`Gap ${gapId} reopen attempt ${attempts}/${MAX_REOPEN_ATTEMPTS}.`);
        await memory.updateGapStatus(gapId, GapStatus.OPEN);
        retryGaps.push(gapId);
      }
    }

    if (escalatedGaps.length > 0) {
      await sendOutboundMessage(
        'qa.agent',
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
    if (initiatorId) {
      const { wakeupInitiator } = await import('../handlers/events/shared');
      await wakeupInitiator(
        baseUserId,
        initiatorId,
        `QA_VERIFICATION_FAILED: The changes for gaps ${retryGaps.join(', ')} failed verification.\n\nAudit Report:\n${auditReport}`,
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
        task: `QA verification failed for gaps: ${retryGaps.join(', ')}.\n\nAudit Report:\n${auditReport}\n\nPlease fix the issues and redeploy.`,
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
    'qa.agent',
    userId,
    `🔍 **QA Audit Complete**\n\n${auditReport}`,
    [baseUserId],
    sessionId,
    config.name,
    resultAttachments
  );

  // 2. Universal Coordination: Notify Initiator (if any)
  await emitTaskEvent({
    source: 'qa.agent',
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
