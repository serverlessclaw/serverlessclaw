import { MessageRole } from '../lib/types/llm';
import { AGENT_TYPES, AgentEvent, AgentPayload } from '../lib/types/agent';
import { ReasoningProfile } from '../lib/types/llm';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  isTaskPaused,
  extractBaseUserId,
  validatePayload,
  buildProcessOptions,
  initAgent,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { CriticVerdictSchema, type CriticVerdict, type ReviewMode } from './critic/schema';
import { CRITIC_SYSTEM_PROMPT } from './prompts';

/**
 * Critic Agent handler. Performs independent peer review of strategic plans
 * as part of the Council of Agents.
 *
 * @param event - The EventBridge event containing the plan to review.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the agent's verdict string.
 */
export const handler = async (event: AgentEvent, context: Context): Promise<string | undefined> => {
  logger.info('Critic Agent received task:', JSON.stringify(event, null, 2));

  const payload = extractPayload<AgentPayload>(event);
  const { userId, task, metadata, traceId, sessionId, initiatorId, depth } = payload;

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);
  const reviewMode = (metadata?.reviewMode as ReviewMode) ?? 'architect';
  const planId = (metadata?.planId as string) ?? 'unknown';
  const collaborationId = (metadata?.collaborationId as string) ?? undefined;

  logger.info(
    `[CRITIC] Reviewing plan ${planId} in ${reviewMode} mode ${collaborationId ? `(Collaboration: ${collaborationId})` : ''}`
  );

  // 1. Initialize agent
  const { config, agent, memory } = await initAgent(AGENT_TYPES.CRITIC, {
    workspaceId: payload.workspaceId,
  });

  // 1.1 Handle Collaboration
  if (collaborationId) {
    try {
      const collaboration = await memory.getCollaboration(collaborationId);
      if (collaboration) {
        const hasAccess = await memory.checkCollaborationAccess(
          collaborationId,
          AGENT_TYPES.CRITIC,
          'agent',
          'editor'
        );
        if (hasAccess) {
          logger.info(`[CRITIC] Successfully joined collaboration ${collaborationId}`);
        } else {
          logger.warn(`[CRITIC] No access to collaboration ${collaborationId}`);
        }
      } else {
        logger.warn(`[CRITIC] Collaboration ${collaborationId} not found`);
      }
    } catch (e) {
      logger.error(`[CRITIC] Error joining collaboration ${collaborationId}:`, e);
    }
  }

  // 2. Build review prompt based on mode
  const reviewPrompt = CRITIC_SYSTEM_PROMPT.replace('{{PLAN_ID}}', planId)
    .replace('{{REVIEW_MODE}}', reviewMode)
    .replace('{{STRATEGIC_PLAN}}', task || '');

  // 3. Process the review with structured JSON output
  const { responseText: rawResponse, attachments: resultAttachments } = await agent.process(
    userId,
    reviewPrompt,
    buildProcessOptions({
      profile: ReasoningProfile.THINKING,
      isIsolated: true,
      context,
      initiatorId,
      depth,
      traceId,
      sessionId,
      communicationMode: 'json',
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'critic_verdict',
          strict: true,
          schema: CriticVerdictSchema,
        },
      },
    })
  );

  logger.info('Critic Agent Raw Response:', rawResponse);

  // 4. Parse verdict
  let verdict: CriticVerdict;
  try {
    const parsed = parseStructuredResponse<CriticVerdict>(rawResponse);
    verdict = {
      verdict: parsed.verdict ?? 'REJECTED',
      reviewMode: parsed.reviewMode ?? reviewMode,
      confidence: parsed.confidence ?? 5,
      findings: parsed.findings ?? [],
      summary: parsed.summary ?? rawResponse,
    };
    logger.info(
      `[CRITIC] Verdict: ${verdict.verdict} | Mode: ${verdict.reviewMode} | Confidence: ${verdict.confidence}`
    );
  } catch (e) {
    logger.warn('Failed to parse Critic structured response, defaulting to REJECTED.', e);
    verdict = {
      verdict: 'REJECTED',
      reviewMode,
      confidence: 1,
      findings: [
        {
          severity: 'high',
          category: 'parse_error',
          description: 'Critic agent failed to produce a valid structured verdict.',
        },
      ],
      summary: rawResponse,
    };
  }

  // 4.1 Write to Collaboration if active
  if (collaborationId) {
    try {
      const collaboration = await memory.getCollaboration(collaborationId);
      if (collaboration) {
        await memory.addMessage(collaboration.syntheticUserId, {
          role: MessageRole.ASSISTANT,
          content: `**CRITIC VERDICT: ${verdict.verdict}**\n\nMode: ${verdict.reviewMode}\nConfidence: ${verdict.confidence}\nSummary: ${verdict.summary}\n\nFindings: ${JSON.stringify(verdict.findings, null, 2)}`,
          agentName: AGENT_TYPES.CRITIC,
          traceId,
          messageId: `critic-${planId}-${Date.now()}`,
        });
        logger.info(`[CRITIC] Verdict shared in collaboration ${collaborationId}`);
      }
    } catch (e) {
      logger.error(`[CRITIC] Error sharing verdict in collaboration ${collaborationId}:`, e);
    }
  }

  // 5. Check for critical findings
  const hasCriticalFindings = verdict.findings.some((f) => f.severity === 'critical');

  if (hasCriticalFindings) {
    logger.warn(`[CRITIC] CRITICAL findings detected for plan ${planId}`);
    await sendOutboundMessage(
      AGENT_TYPES.CRITIC,
      userId,
      `🚨 **Critical Review Finding** (${reviewMode}):\n\n${verdict.summary}`,
      [baseUserId],
      sessionId,
      config.name
    );
  }

  // 6. Notify initiator via universal coordination
  if (!isTaskPaused(rawResponse)) {
    await emitTaskEvent({
      source: AGENT_TYPES.CRITIC,
      agentId: AGENT_TYPES.CRITIC,
      userId: baseUserId,
      task: `Review plan ${planId} (${reviewMode})`,
      response: JSON.stringify(verdict),
      attachments: resultAttachments,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });
  }

  return JSON.stringify(verdict);
};
