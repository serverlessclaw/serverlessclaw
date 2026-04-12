import { AgentType, TraceSource, Attachment, AgentPayload } from '../lib/types/agent';
import { ReasoningProfile } from '../lib/types/llm';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import {
  extractPayload,
  loadAgentConfig,
  extractBaseUserId,
  getAgentContext,
} from '../lib/utils/agent-helpers';
import { buildTelemetry } from './strategic-planner/prompts';
import { buildProactiveReviewPrompt, buildReactivePrompt } from './strategic-planner/prompts';
import type { PlannerEvent, PlannerResult, PlannerPayload } from './strategic-planner/types';
import { validatePlan } from './strategic-planner/validation';
import { handleCouncilReviewResult } from './strategic-planner/council';
import { manageProactiveScheduling } from './strategic-planner/scheduler';
import { isGapInCooldown } from './strategic-planner/evolution';
import {
  calculateCodeGrowth,
  emitAuditEvent,
  type CodeGrowthMetrics,
} from './strategic-planner/code-growth';

import { AGENT_ERRORS } from '../lib/constants';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { StrategicPlanSchema } from './strategic-planner/schema';
import { Agent } from '../lib/agent';

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

  const isProactive = !!(
    (metadata as unknown as Record<string, unknown>)?.isProactive || isScheduledReview
  );

  // Extract base userId (remove CONV# prefix if present)
  const baseUserId = extractBaseUserId(userId);

  // 1. Fetch System Context
  const [config, { memory, provider: providerManager }, { getAgentTools }] = await Promise.all([
    loadAgentConfig(AgentType.STRATEGIC_PLANNER),
    getAgentContext(),
    import('../tools/registry-utils'),
  ]);

  const agentTools = await getAgentTools(AgentType.STRATEGIC_PLANNER);

  const plannerAgent = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);

  // 1.1 Council Review Continuation Logic
  const councilResult = await handleCouncilReviewResult(
    task,
    traceId || '',
    memory,
    baseUserId,
    userId,
    config
  );
  if (councilResult) {
    return councilResult;
  }

  // Self-Scheduling: If this is a proactive review, or we are running for any reason,
  // ensure the NEXT proactive review is scheduled if not already present.
  if (isProactive) {
    await manageProactiveScheduling(baseUserId, userId);
  }

  // Code Growth Tracking: Check if audit should be triggered based on code growth
  const metadataObj = (metadata as unknown as Record<string, unknown>) || {};
  const currentLOC = (metadataObj.codeLOC as number) || 0;
  if (currentLOC > 0) {
    const { shouldTriggerAudit, metrics } = await calculateCodeGrowth(
      memory as unknown as {
        get(key: string): Promise<CodeGrowthMetrics | null>;
        set(key: string, value: unknown): Promise<void>;
      },
      currentLOC
    );
    if (shouldTriggerAudit) {
      logger.info(
        `[PLANNER] Code growth ${(metrics.growthPercentage * 100).toFixed(2)}% exceeds threshold, triggering audit`
      );
      await emitAuditEvent(metrics);
    }
  }

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

    // 2b. Conflict Detection: Acquire gap lock to prevent race conditions
    const lockAcquired = await memory.acquireGapLock(gapId, AgentType.STRATEGIC_PLANNER);
    if (!lockAcquired) {
      const lockInfo = await memory.getGapLock(gapId);
      if (lockInfo?.agentId === '__LOCK_CHECK_FAILED__') {
        logger.error(
          `Could not verify gap lock state for ${gapId}. Aborting to prevent race condition.`
        );
        return { status: 'GAP_LOCK_CHECK_FAILED' };
      }
      logger.warn(
        `Gap ${gapId} is locked by ${lockInfo?.agentId ?? 'unknown'}. Skipping to prevent conflict.`
      );
      return { status: 'GAP_LOCKED', lockedBy: lockInfo?.agentId };
    }
  }

  // 3. Process with High Reasoning via unified lifecycle (Session Locking + Heartbeat)
  const { processEventWithAgent } = await import('../handlers/events/shared');
  
  let responseText = '';
  let attachments: Attachment[] = [];
  
  try {
    const result = await processEventWithAgent(userId, AgentType.STRATEGIC_PLANNER, plannerPrompt, {
      context: _context,
      traceId,
      taskId: traceId,
      sessionId,
      depth,
      initiatorId,
      isContinuation: isProactive,
      attachments: (metadata as unknown as AgentPayload | undefined)?.attachments as Attachment[],
      handlerTitle: 'Strategic Planner',
      outboundHandlerName: AgentType.STRATEGIC_PLANNER,
      formatResponse: (text) => text,
      tokenBudget: config.tokenBudget,
      costLimit: config.costLimit,
    });
    responseText = result.responseText;
    attachments = result.attachments;
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    logger.error(`[StrategicPlanner] Unified execution failure: ${errorDetail}`, error);
    responseText = AGENT_ERRORS.PROCESS_FAILURE;
  }

  const planId = `PLAN-${Date.now()}-${randomUUID().substring(0, 8)}`;
  logger.info(`[PLANNER] Generated Plan ID: ${planId}`);
  logger.info('Strategic Plan Raw Response:', responseText);

  const isSystemFailure = responseText === AGENT_ERRORS.PROCESS_FAILURE;

  let status = 'SUCCESS';
  let plan = responseText;
  let coveredGapIds: string[] = [];
  let toolOptimizations: Array<{ action: string; toolName: string; reason: string }> = [];
  let structuredTasks: Array<{ agentId: string; task: string; gapIds: string[] }> | undefined;

  if (!isSystemFailure && isProactive) {
    try {
      const parsed = parseStructuredResponse<{
        status: string;
        plan: string;
        coveredGapIds: string[];
        tasks?: Array<{ agentId: string; task: string; gapIds: string[] }>;
        toolOptimizations?: Array<{ action: string; toolName: string; reason: string }>;
      }>(responseText);
      status = parsed.status || 'SUCCESS';
      plan = parsed.plan || responseText;
      coveredGapIds = parsed.coveredGapIds ?? [];
      structuredTasks = parsed.tasks;
      toolOptimizations = parsed.toolOptimizations ?? [];
      logger.info(
        `Parsed Strategic Plan. Status: ${status}, Gaps: ${coveredGapIds.join(', ')}, StructuredTasks: ${structuredTasks?.length ?? 0}`
      );
    } catch (e) {
      logger.warn('Failed to parse Planner structured response, falling back to raw text.', e);
    }
  }

  // B2: Validate plan before coder dispatch
  const validation = validatePlan(plan, coveredGapIds);
  if (!validation.isValid && status === 'SUCCESS') {
    logger.warn(`[PLANNER] Plan validation failed: ${validation.reason}`);
    status = 'FAILED';
  }

  const isFailure = status === 'FAILED' || !validation.isValid;

  // Use post-processing submodule
  const { postProcessPlan } = await import('./strategic-planner/processing');
  return await postProcessPlan(memory, {
    plan,
    planId,
    status,
    coveredGapIds,
    toolOptimizations,
    structuredTasks,
    isFailure,
    baseUserId,
    userId,
    sessionId: sessionId || '',
    traceId: traceId || '',
    initiatorId: initiatorId || '',
    depth: depth || 0,
    gapId,
    task: task || 'Strategic Review',
    isScheduledReview: isScheduledReview || false,
    config,
    metadata: (metadata as unknown as Record<string, unknown>) || {},
  });
}
