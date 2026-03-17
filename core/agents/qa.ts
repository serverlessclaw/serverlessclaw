import {
  ReasoningProfile,
  GapStatus,
  AgentType,
  EvolutionMode,
  TraceSource,
  AgentEvent,
  AgentPayload,
} from '../lib/types/index';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  loadAgentConfig,
  getAgentContext,
  emitTaskEvent,
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

  // 1. Discovery & Initialization
  const config = await loadAgentConfig(AgentType.QA);
  const { memory, provider: providerManager } = await getAgentContext();

  const { getAgentTools } = await import('../tools/index');
  const agentTools = await getAgentTools('qa');
  const { Agent } = await import('../lib/agent');
  const qaAgent = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);

  // IMPORTANT: The Coder's implementation response is provided below only as background context.
  // Do NOT anchor your verdict on the Coder's self-reported success — it may be inaccurate.
  // You MUST independently verify using at least one of: validateCode, read_file, listFiles, checkHealth.
  // Only issue VERIFICATION_SUCCESSFUL after your own mechanical checks confirm the change is live and correct.
  const auditPrompt = `You are auditing the following gaps independently. Do NOT trust the Coder's response alone.

    STEP 1 — MECHANICAL CHECK (mandatory): Call at least one verification tool before forming a verdict:
      - Use 'validateCode' to confirm no type errors were introduced.
      - Use 'read_file' or 'listFiles' to verify the relevant code was actually written/modified.
      - Use 'checkHealth' if the change affects a live endpoint.

    STEP 2 — VERDICT: After your tool checks, respond with VERIFICATION_SUCCESSFUL or REOPEN_REQUIRED.

    Background (Coder's self-report — treat as unverified):
    ${implementationResponse}

    Target Gaps:
    ${gapIds.join(', ')}

    Final response MUST include VERIFICATION_SUCCESSFUL or REOPEN_REQUIRED.`;

  const { responseText: rawResponse, attachments: resultAttachments } = await qaAgent.process(
    userId,
    auditPrompt,
    {
      profile: ReasoningProfile.THINKING,
      isIsolated: true,
      source: TraceSource.SYSTEM,
      initiatorId,
      depth,
      traceId,
      sessionId,
    }
  );

  logger.info('QA Agent Raw Response:', rawResponse);

  let status = 'REOPEN';
  let auditReport = rawResponse;

  try {
    const jsonContent = rawResponse.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonContent);
    status = parsed.status === 'SUCCESS' ? 'SUCCESS' : 'REOPEN';
    auditReport = parsed.auditReport || rawResponse;
    logger.info(`Parsed QA Result. Status: ${status}`);
  } catch (e) {
    logger.warn('Failed to parse QA structured response, falling back to raw text.', e);
  }

  const isSatisfied = status === 'SUCCESS';

  // Resolve evolution mode
  let evolutionMode = EvolutionMode.HITL;
  try {
    const { AgentRegistry } = await import('../lib/registry');
    const mode = await AgentRegistry.getRawConfig('evolution_mode');
    if (mode === 'auto') evolutionMode = EvolutionMode.AUTO;
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
        [userId],
        traceId,
        config.name
      );
    }

    if (retryGaps.length > 0) {
      const { tools } = await import('../tools/index');
      const dispatcher = tools.dispatchTask;
      await dispatcher.execute({
        agentId: AgentType.CODER,
        userId,
        task: `QA verification failed for gaps: ${retryGaps.join(', ')}.\n\nAudit Report:\n${auditReport}\n\nPlease fix the issues and redeploy.`,
        metadata: { gapIds: retryGaps },
        traceId,
        sessionId,
      });
    }
  }

  // 1. Notify user directly in the chat session
  await sendOutboundMessage(
    'qa.agent',
    userId,
    `🔍 **QA Audit Complete**\n\n${auditReport}`,
    [userId],
    traceId,
    config.name,
    resultAttachments
  );

  // 2. Universal Coordination: Notify Initiator (if any)
  await emitTaskEvent({
    source: 'qa.agent',
    agentId: AgentType.QA,
    userId,
    task: `Audit gaps: ${gapIds.join(', ')}`,
    response: auditReport,
    attachments: resultAttachments,
    traceId,
    sessionId,
    initiatorId,
    depth,
  });
};
