import { AgentType, EvolutionMode, GapStatus, TraceSource } from '../lib/types/agent';
import { InsightCategory } from '../lib/types/memory';
import { ReasoningProfile } from '../lib/types/llm';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  loadAgentConfig,
  extractBaseUserId,
  getAgentContext,
  isTaskPaused,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { parseConfigInt } from '../lib/providers/utils';
import { getEvolutionMode, recordCooldown, isGapInCooldown } from './strategic-planner/evolution';
import {
  buildProactiveReviewPrompt,
  buildReactivePrompt,
  buildTelemetry,
} from './strategic-planner/prompts';
import type { PlannerEvent, PlannerResult, PlannerPayload } from './strategic-planner/types';

/**
 * Planner Agent handler. Analyzes capability gaps and generates strategic plans.
 *
 * @param event - The event containing gap details or scheduling information.
 * @param _context - The AWS Lambda context (unused).
 * @returns A promise that resolves to an object with gapId and the plan, or a status object.
 */
export async function handler(event: PlannerEvent, _context: Context): Promise<PlannerResult> {
  logger.info('[PLANNER] Received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<PlannerPayload>(event);
  const {
    userId,
    task = 'Strategic Review',
    gapId,
    metadata,
    isScheduledReview,
    traceId,
    initiatorId,
    depth,
    sessionId,
  } = payload;

  logger.info(
    `[PLANNER] Input: User=${userId} | Session=${sessionId} | Task=${task.substring(0, 50)}`
  );

  if (!userId) {
    logger.error('Planner Agent received payload without userId. Aborting.');
    return { status: 'FAILED_MISSING_USER_ID' };
  }

  const isProactive =
    (metadata as unknown as Record<string, unknown>)?.isProactive || isScheduledReview;

  // Extract base userId (remove CONV# prefix if present)
  const baseUserId = extractBaseUserId(userId);

  // 1. Fetch System Context
  const config = await loadAgentConfig(AgentType.STRATEGIC_PLANNER);
  const { memory, provider: providerManager } = await getAgentContext();

  const { getAgentTools } = await import('../tools/registry-utils');
  const agentTools = await getAgentTools('planner');

  // Self-Scheduling: If this is a proactive review, or we are running for any reason,
  // ensure the NEXT proactive review is scheduled if not already present.
  if (isProactive) {
    try {
      const { DynamicScheduler } = await import('../lib/scheduler');
      const { AgentRegistry } = await import('../lib/registry');

      const GOAL_ID = `PLANNER#STRATEGIC_REVIEW#${baseUserId}`;
      const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency');
      const frequencyHrs = parseConfigInt(customFreq, 24);

      await DynamicScheduler.ensureProactiveGoal({
        goalId: GOAL_ID,
        agentId: AgentType.STRATEGIC_PLANNER,
        task: 'Proactive Strategic Review',
        userId: userId,
        frequencyHrs,
        metadata: { isProactive: true },
      });
    } catch (e) {
      logger.warn('Failed to manage proactive self-scheduling:', e);
    }
  }

  const { Agent } = await import('../lib/agent');
  const plannerAgent = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);
  const toolsList = agentTools
    .map((t: { name: string; description: string }) => `- ${t.name}: ${t.description}`)
    .join('\n    ');
  const telemetry = buildTelemetry(toolsList);

  const failurePatterns = await memory.getFailurePatterns(baseUserId, '*', 5);

  let plannerPrompt: string;

  if (isProactive) {
    const proactiveResult = await buildProactiveReviewPrompt(
      memory,
      baseUserId,
      telemetry,
      isScheduledReview ?? false,
      failurePatterns
    );

    if (!proactiveResult.shouldRun) {
      return { status: proactiveResult.status };
    }

    plannerPrompt = proactiveResult.prompt;
  } else {
    // Reactionary single gap handling
    plannerPrompt = buildReactivePrompt(
      { ...payload, contextUserId: userId, details: task },
      telemetry,
      failurePatterns
    );
  }

  // 2. Self-Evolution Loop Protection (Cool-down)
  if (gapId) {
    const inCooldown = await isGapInCooldown(memory, gapId, baseUserId);
    if (inCooldown) {
      logger.warn(`Evolution cooldown active for gap ${gapId}. Aborting.`);
      return { status: 'COOLDOWN_ACTIVE' };
    }
  }

  // 3. Process with High Reasoning
  const { responseText: rawResponse, attachments: resultAttachments } = await plannerAgent.process(
    userId,
    plannerPrompt,
    {
      profile: ReasoningProfile.DEEP,
      isIsolated: true,
      initiatorId,
      depth,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
      communicationMode: 'json',
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'strategic_plan',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['SUCCESS', 'FAILED'] },
              plan: { type: 'string' },
              coveredGapIds: { type: 'array', items: { type: 'string' } },
              toolOptimizations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action: { type: 'string', enum: ['PRUNE', 'CONSOLIDATE', 'REPLACE'] },
                    toolName: { type: 'string' },
                    reason: { type: 'string' },
                  },
                  required: ['action', 'toolName', 'reason'],
                  additionalProperties: false,
                },
              },
            },
            required: ['status', 'plan', 'coveredGapIds'],
            additionalProperties: false,
          },
        },
      },
    }
  );

  const planId = `PLAN-${Date.now()}`;
  logger.info(`[PLANNER] Generated Plan ID: ${planId}`);

  logger.info('Strategic Plan Raw Response:', rawResponse);

  let status = 'SUCCESS';
  let plan = rawResponse;
  let coveredGapIds: string[] = [];
  let toolOptimizations: Array<{ action: string; toolName: string; reason: string }> = [];

  try {
    const parsed = parseStructuredResponse<{
      status: string;
      plan: string;
      coveredGapIds: string[];
      toolOptimizations?: Array<{ action: string; toolName: string; reason: string }>;
    }>(rawResponse);
    status = parsed.status || 'SUCCESS';
    plan = parsed.plan || rawResponse;
    coveredGapIds = parsed.coveredGapIds || [];
    toolOptimizations = parsed.toolOptimizations || [];
    logger.info(`Parsed Strategic Plan. Status: ${status}, Gaps: ${coveredGapIds.join(', ')}`);
  } catch (e) {
    logger.warn('Failed to parse Planner structured response, falling back to raw text.', e);
  }

  // 1.5 Generate gaps from toolOptimizations
  if (toolOptimizations.length > 0) {
    for (const opt of toolOptimizations) {
      const toolGapId = `TOOLOPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const gapContent = `[TOOL_OPTIMIZATION] Action: ${opt.action}, Tool: ${opt.toolName}. Reason: ${opt.reason}`;
      logger.info(`Recording tool optimization gap: ${gapContent}`);
      await memory.setGap(toolGapId, gapContent, {
        category: InsightCategory.STRATEGIC_GAP,
        confidence: 9,
        impact: 6,
        complexity: 4,
        risk: 2,
        urgency: 5,
        priority: 5,
      });
    }
  }

  const isFailure =
    status === 'FAILED' ||
    plan.startsWith('I encountered an internal error') ||
    plan === 'Empty response from OpenAI.';

  // 1. Notify user directly in the chat session ONLY if successful and not empty
  if (!isFailure && plan !== 'Empty response from OpenAI.') {
    await sendOutboundMessage(
      'planner.agent',
      baseUserId,
      `🚀 **Strategic Plan Generated**\n\n${plan}`,
      [baseUserId],
      sessionId,
      config.name,
      resultAttachments,
      undefined,
      [
        { label: '🚀 Approve', value: `APPROVE ${planId}` },
        { label: '🤔 Clarify', value: `CLARIFY ${planId}` },
      ]
    );
  } else {
    logger.warn(`Skipping user notification for failed or empty strategic plan: ${plan}`);
  }

  // 2. Emit Task Result for Universal Coordination
  if (!isTaskPaused(rawResponse)) {
    await emitTaskEvent({
      source: 'planner.agent',
      userId: baseUserId,
      agentId: AgentType.STRATEGIC_PLANNER,
      task: isScheduledReview ? 'Scheduled Review' : task,
      response: plan,
      error: isFailure ? plan : undefined,
      traceId,
      initiatorId: payload.initiatorId,
      depth: payload.depth,
      sessionId,
      userNotified: true,
    });
  }

  // 4. Record gap in structured cooldown store
  if (gapId && !isFailure) {
    await recordCooldown(memory, gapId, baseUserId);
  }

  // 5. Gap Sink: Mark covered gaps as PLANNED
  const processedGapIds: string[] = [];
  if (!isFailure) {
    if (isScheduledReview || coveredGapIds.length > 0) {
      logger.info(`Marking ${coveredGapIds.length} gaps as PLANNED based on structured output.`);
      for (const gId of coveredGapIds) {
        const numericId = gId.replace('GAP#', '');
        await memory.updateGapStatus(numericId, GapStatus.PLANNED);
        processedGapIds.push(numericId);
      }
    } else if (gapId) {
      logger.info(`Marking specific gap ${gapId} as PLANNED after design.`);
      await memory.updateGapStatus(gapId, GapStatus.PLANNED);
      processedGapIds.push(gapId);
    }
  }

  // 6. Save plan for QA auditing and HITL resolution
  for (const gapIdToSave of processedGapIds) {
    await memory.updateDistilledMemory(`PLAN#${gapIdToSave}`, plan);
  }
  await memory.updateDistilledMemory(
    `PLAN#${planId}`,
    JSON.stringify({ plan, gapIds: processedGapIds })
  );

  const evolutionMode = await getEvolutionMode();

  if (evolutionMode === EvolutionMode.AUTO && !isFailure && processedGapIds.length > 0) {
    logger.info('Evolution mode is auto, dispatching CODER_TASK directly.');
    await sendOutboundMessage(
      'planner.agent',
      baseUserId,
      `🚀 **Autonomous Evolution Triggered**\n\nI have identified a capability gap and designed a plan to fix it. The Coder Agent is now executing the following STRATEGIC_PLAN:\n\n${plan}`,
      [baseUserId],
      sessionId,
      config.name,
      undefined
    );

    const { DISPATCH_TASK: dispatcher } = await import('../tools/knowledge-agent');
    await dispatcher.execute({
      agentId: AgentType.CODER,
      userId: baseUserId,
      task: plan,
      metadata: {
        gapIds: processedGapIds,
      },
      traceId,
      sessionId,
    });
  } else if (!isFailure && processedGapIds.length > 0) {
    logger.info('Evolution mode is hitl, asking for approval.');
    await sendOutboundMessage(
      'planner.agent',
      baseUserId,
      `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${plan}\n\nReply with 'APPROVE' to execute.`,
      [baseUserId],
      sessionId,
      config.name,
      undefined
    );
  }

  return { gapId, plan, planId };
}
