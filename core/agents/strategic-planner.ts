import { AgentType, EvolutionMode, GapStatus, TraceSource, EventType } from '../lib/types/agent';
import { InsightCategory } from '../lib/types/memory';
import { ReasoningProfile, Message, MessageRole } from '../lib/types/llm';
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
import { AGENT_ERRORS, TRACE_TYPES } from '../lib/constants';
import { getEvolutionMode, recordCooldown, isGapInCooldown } from './strategic-planner/evolution';
import {
  buildProactiveReviewPrompt,
  buildReactivePrompt,
  buildTelemetry,
} from './strategic-planner/prompts';
import type { PlannerEvent, PlannerResult, PlannerPayload } from './strategic-planner/types';

import { INSIGHT_DEFAULTS } from '../lib/constants';
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
  const config = await loadAgentConfig(AgentType.STRATEGIC_PLANNER);
  const { memory, provider: providerManager } = await getAgentContext();

  const { getAgentTools } = await import('../tools/registry-utils');
  const agentTools = await getAgentTools(AgentType.STRATEGIC_PLANNER);

  const plannerAgent = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);

  // 1.1 Council Review Continuation Logic
  if (task.includes('[COUNCIL_REVIEW_RESULT]') || task.includes('VERDICT:')) {
    logger.info(`[PLANNER] Detected Council review result for trace ${traceId}`);

    // Trace: Council review results being processed
    const { addTraceStep } = await import('../lib/utils/trace-helper');
    await addTraceStep(traceId, 'root', {
      type: TRACE_TYPES.COUNCIL_REVIEW,
      content: {
        verdict: task.includes('VERDICT: APPROVED')
          ? 'APPROVED'
          : task.includes('VERDICT: REJECTED')
            ? 'REJECTED'
            : 'CONDITIONAL',
        summary: task,
        initiatorId: AgentType.STRATEGIC_PLANNER,
      },
      metadata: { event: 'council_review_processed', traceId },
    });

    // The traceId here will be the unique councilTraceId we used during dispatch
    const councilDataStr = await memory.getDistilledMemory(`COUNCIL_PLAN#${traceId}`);
    if (councilDataStr) {
      const {
        plan: originalPlan,
        gapIds,
        sessionId: originalSessionId,
        planId: originalPlanId,
        collaborationId: councilCollabId,
      } = JSON.parse(councilDataStr);

      const isApproved = task.includes('VERDICT: APPROVED') || task.includes('APPROVED');
      const isConditional = task.includes('VERDICT: CONDITIONAL') || task.includes('CONDITIONAL');

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
            AgentType.STRATEGIC_PLANNER,
            userId,
            `✅ **Council Approval Received**\n\nThe Council of Agents has ${isApproved ? 'approved' : 'conditionally approved'} the plan. Dispatching to Coder Agent for execution.\n\nSummary of Review:\n${task}`,
            [baseUserId],
            sessionId,
            config.name
          );

          const { dispatchTask: dispatcher } = await import('../tools/knowledge/agent');
          await dispatcher.execute({
            agentId: AgentType.CODER,
            userId: baseUserId,
            task: originalPlan,
            metadata: { gapIds },
            traceId,
            sessionId: originalSessionId || sessionId,
          });
        } else {
          logger.info('[PLANNER] Evolution mode is hitl, asking for human approval.');
          await sendOutboundMessage(
            AgentType.STRATEGIC_PLANNER,
            userId,
            `✅ **Council Approval Received**\n\nThe Council of Agents has approved the plan with findings:\n\n${task}\n\nDo you want to execute the original plan?\n\nPlan:\n${originalPlan}`,
            [baseUserId],
            sessionId,
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
          AgentType.STRATEGIC_PLANNER,
          userId,
          `❌ **Council Review REJECTED**\n\nThe Council has rejected the strategic plan. Implementation has been blocked for safety. Please review the findings and revise the strategy.\n\nFeedback:\n${task}`,
          [baseUserId],
          sessionId,
          config.name
        );
      }

      return {
        status: isApproved || isConditional ? 'COUNCIL_APPROVED' : 'COUNCIL_REJECTED',
        plan: originalPlan,
      };
    } else {
      logger.warn(
        `[PLANNER] Received Council review result but could not find original plan for trace ${traceId}`
      );
    }
  }

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
      logger.warn(
        `Gap ${gapId} is locked by ${lockInfo?.content ?? 'unknown'}. Skipping to prevent conflict.`
      );
      return { status: 'GAP_LOCKED', lockedBy: lockInfo?.content };
    }
  }

  // 3. Process with High Reasoning
  let rawResponse = '';
  const resultAttachments: NonNullable<Message['attachments']> = [];

  try {
    const stream = plannerAgent.stream(userId, plannerPrompt, {
      profile: ReasoningProfile.DEEP,
      isIsolated: isProactive,
      initiatorId,
      depth,
      traceId,
      sessionId,
      source: TraceSource.DASHBOARD,
      communicationMode: isProactive ? 'json' : 'text',
      responseFormat: isProactive
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'strategic_plan',
              strict: true,
              schema: StrategicPlanSchema,
            },
          }
        : undefined,
    });

    for await (const chunk of stream) {
      if (chunk.content) rawResponse += chunk.content;
      // Attachments from chunks are not currently used in planner but handled for consistency
    }
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    logger.error(`[StrategicPlanner] Streaming failure: ${errorDetail}`, error);
    rawResponse = AGENT_ERRORS.PROCESS_FAILURE;
  }

  const planId = `PLAN-${Date.now()}`;
  logger.info(`[PLANNER] Generated Plan ID: ${planId}`);

  logger.info('Strategic Plan Raw Response:', rawResponse);

  const isSystemFailure = rawResponse === AGENT_ERRORS.PROCESS_FAILURE;

  let status = 'SUCCESS';
  let plan = rawResponse;
  let coveredGapIds: string[] = [];
  let toolOptimizations: Array<{ action: string; toolName: string; reason: string }> = [];

  if (!isSystemFailure && isProactive) {
    try {
      const parsed = parseStructuredResponse<{
        status: string;
        plan: string;
        coveredGapIds: string[];
        toolOptimizations?: Array<{ action: string; toolName: string; reason: string }>;
      }>(rawResponse);
      status = parsed.status || 'SUCCESS';
      plan = parsed.plan || rawResponse;
      coveredGapIds = parsed.coveredGapIds ?? [];
      toolOptimizations = parsed.toolOptimizations ?? [];
      logger.info(`Parsed Strategic Plan. Status: ${status}, Gaps: ${coveredGapIds.join(', ')}`);
    } catch (e) {
      logger.warn('Failed to parse Planner structured response, falling back to raw text.', e);
    }
  }

  const isFailure =
    status === 'FAILED' ||
    plan.startsWith('I encountered an internal error') ||
    plan === 'Empty response from OpenAI.';

  if (!isFailure && status === 'SUCCESS') {
    const { addTraceStep } = await import('../lib/utils/trace-helper');
    await addTraceStep(traceId, 'root', {
      type: TRACE_TYPES.PLAN_GENERATED,
      content: {
        planId,
        status,
        coveredGaps: coveredGapIds,
        planSnippet: plan.substring(0, 500),
      },
      metadata: { event: 'plan_generated', planId },
    });
  }

  // 1.5 Generate gaps from toolOptimizations
  if (toolOptimizations.length > 0) {
    for (const opt of toolOptimizations) {
      const toolGapId = Date.now().toString();
      const gapContent = `[TOOL_OPTIMIZATION] Action: ${opt.action}, Tool: ${opt.toolName}. Reason: ${opt.reason}`;
      logger.info(`Recording tool optimization gap: ${gapContent}`);
      await memory.setGap(toolGapId, gapContent, {
        category: InsightCategory.SYSTEM_IMPROVEMENT,
        confidence: INSIGHT_DEFAULTS.CONFIDENCE,
        impact: INSIGHT_DEFAULTS.IMPACT,
        complexity: INSIGHT_DEFAULTS.COMPLEXITY,
        risk: INSIGHT_DEFAULTS.RISK,
        urgency: INSIGHT_DEFAULTS.URGENCY,
        priority: INSIGHT_DEFAULTS.PRIORITY,
      });
    }
  }

  // 1. Notify user directly in the chat session ONLY if successful and not empty
  if (!isFailure && plan !== 'Empty response from OpenAI.') {
    await sendOutboundMessage(
      AgentType.STRATEGIC_PLANNER,
      userId,
      plan.startsWith('🚀') ? plan : `🚀 **Strategic Plan Generated**\n\n${plan}`,
      [baseUserId],
      sessionId,
      config.name,
      resultAttachments,
      traceId ? `${traceId}-${AgentType.STRATEGIC_PLANNER}` : undefined,
      [
        { label: 'Approve', value: `APPROVE ${planId}` },
        { label: 'Clarify', value: `CLARIFY ${planId}` },
        { label: 'Dismiss', value: `DISMISS ${planId}`, type: 'secondary' as const },
      ]
    );
  } else {
    logger.warn(`Skipping user notification for failed or empty strategic plan: ${plan}`);
  }

  // 2. Emit Task Result for Universal Coordination
  if (!isTaskPaused(rawResponse)) {
    await emitTaskEvent({
      source: AgentType.STRATEGIC_PLANNER,
      userId: baseUserId,
      agentId: AgentType.STRATEGIC_PLANNER,
      task: isScheduledReview ? 'Scheduled Review' : task,
      response: plan,
      error: isFailure ? plan : undefined,
      traceId,
      initiatorId: payload.initiatorId,
      depth: payload.depth,
      sessionId,
      userNotified: !isFailure,
    });
  }

  // 4. Record gap in structured cooldown store
  if (gapId && !isFailure) {
    await recordCooldown(memory, gapId, baseUserId);
  }

  // 5. Gap Sink: Mark covered gaps as PLANNED + assign to tracks
  const processedGapIds: string[] = [];
  if (!isFailure) {
    if (isScheduledReview || coveredGapIds.length > 0) {
      logger.info(`Marking ${coveredGapIds.length} gaps as PLANNED based on structured output.`);
      const { assignGapToTrack, determineTrack } = await import('../lib/memory/gap-operations');
      for (const gId of coveredGapIds) {
        const numericId = gId.replace('GAP#', '');
        await memory.updateGapStatus(numericId, GapStatus.PLANNED);
        // Assign to evolution track based on plan content
        await assignGapToTrack(
          memory as unknown as Parameters<typeof assignGapToTrack>[0],
          numericId,
          determineTrack(plan)
        );
        processedGapIds.push(numericId);
      }
    } else if (gapId) {
      logger.info(`Marking specific gap ${gapId} as PLANNED after design.`);
      await memory.updateGapStatus(gapId, GapStatus.PLANNED);
      const { assignGapToTrack, determineTrack } = await import('../lib/memory/gap-operations');
      await assignGapToTrack(memory as never, gapId, determineTrack(plan));
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

  // Council of Agents: Check if plan requires peer review
  const COUNCIL_THRESHOLD = 8;
  const gapImpact = ((metadata as unknown as Record<string, unknown>)?.impact as number) ?? 0;
  const gapRisk = ((metadata as unknown as Record<string, unknown>)?.risk as number) ?? 0;
  const gapComplexity =
    ((metadata as unknown as Record<string, unknown>)?.complexity as number) ?? 0;
  const requiresCouncil =
    gapImpact >= COUNCIL_THRESHOLD ||
    gapRisk >= COUNCIL_THRESHOLD ||
    gapComplexity >= COUNCIL_THRESHOLD;

  if (requiresCouncil && !isFailure && processedGapIds.length > 0) {
    // Council Review: Dispatch to Critic Agent for peer review before Coder
    logger.info(
      `[PLANNER] Plan requires Council review (impact=${gapImpact}, risk=${gapRisk}, complexity=${gapComplexity}). Dispatching parallel critic tasks.`
    );

    await sendOutboundMessage(
      AgentType.STRATEGIC_PLANNER,
      userId,
      `🔍 **Council of Agents Review Initiated**\n\nThe plan has high impact/risk (${Math.max(gapImpact, gapRisk, gapComplexity)}/10). Dispatching to Security, Performance, and Architect reviewers before execution.\n\nPlan:\n\n${plan}`,
      [baseUserId],
      sessionId,
      config.name,
      undefined
    );

    // Create a collaboration session for the Council discussion
    const collaboration = await memory.createCollaboration(baseUserId, 'agent', {
      name: `Council Review: ${planId}`,
      description: `Multi-party peer review for strategic plan ${planId}`,
      initialParticipants: [
        { type: 'agent', id: AgentType.CRITIC, role: 'editor' },
        { type: 'human', id: baseUserId, role: 'viewer' },
      ],
      tags: ['council', 'review', planId],
    });
    const collaborationId = collaboration.collaborationId;
    logger.info(`[PLANNER] Created Council collaboration: ${collaborationId}`);

    // Post the plan to the shared session
    await memory.addMessage(collaboration.syntheticUserId, {
      role: MessageRole.ASSISTANT,
      content: `### COUNCIL REVIEW REQUEST: ${planId}\n\n**Strategic Plan:**\n${plan}\n\n**Context:**\nImpact: ${gapImpact} | Risk: ${gapRisk} | Complexity: ${gapComplexity}\n\nPlease provide your expert feedback and verdict (APPROVED/REJECTED/CONDITIONAL).`,
      agentName: AgentType.STRATEGIC_PLANNER,
    });

    // Dispatch parallel critic reviews
    const { emitTypedEvent } = await import('../lib/utils/typed-emit');
    const councilTraceId = `${traceId || 'council'}-${planId}`;

    const councilTasks = [
      {
        taskId: `critic-security-${planId}`,
        agentId: AgentType.CRITIC,
        task: `Security review of plan:\n\n${plan}`,
        metadata: { reviewMode: 'security', planId, gapIds: processedGapIds, collaborationId },
      },
      {
        taskId: `critic-performance-${planId}`,
        agentId: AgentType.CRITIC,
        task: `Performance review of plan:\n\n${plan}`,
        metadata: { reviewMode: 'performance', planId, gapIds: processedGapIds, collaborationId },
      },
      {
        taskId: `critic-architect-${planId}`,
        agentId: AgentType.CRITIC,
        task: `Architectural review of plan:\n\n${plan}`,
        metadata: { reviewMode: 'architect', planId, gapIds: processedGapIds, collaborationId },
      },
    ];

    await emitTypedEvent(AgentType.STRATEGIC_PLANNER, EventType.PARALLEL_TASK_DISPATCH, {
      userId: baseUserId,
      tasks: councilTasks,
      barrierTimeoutMs: 120000, // 2 minutes
      aggregationType: 'agent_guided' as const,
      aggregationPrompt: `Synthesize the Council discussion in session ${collaborationId} and the individual reviews for Plan ${planId}. Return your response starting with [COUNCIL_REVIEW_RESULT] followed by VERDICT: <APPROVED|REJECTED|CONDITIONAL> and a summary of findings. If all reviews are APPROVED, return VERDICT: APPROVED. If ANY review has verdict REJECTED, return VERDICT: REJECTED with consolidated feedback. Always include the Plan ID ${planId} and Collaboration ID ${collaborationId} in your response.`,
      traceId: councilTraceId,
      initiatorId: AgentType.STRATEGIC_PLANNER,
      depth: (depth ?? 0) + 1,
      sessionId,
    });

    // Save plan for Council aggregation callback
    await memory.updateDistilledMemory(
      `COUNCIL_PLAN#${councilTraceId}`,
      JSON.stringify({
        plan,
        gapIds: processedGapIds,
        userId: baseUserId,
        sessionId,
        traceId: councilTraceId,
        planId,
        collaborationId,
      })
    );
  } else if (evolutionMode === EvolutionMode.AUTO && !isFailure && processedGapIds.length > 0) {
    logger.info('Evolution mode is auto, dispatching CODER_TASK directly.');
    await sendOutboundMessage(
      AgentType.STRATEGIC_PLANNER,
      userId,
      `🚀 **Autonomous Evolution Triggered**\n\nI have identified a capability gap and designed a plan to fix it. The Coder Agent is now executing the following STRATEGIC_PLAN:\n\n${plan}`,
      [baseUserId],
      sessionId,
      config.name,
      undefined
    );

    // Attempt plan decomposition for complex plans
    const { decomposePlan } = await import('./strategic-planner/decomposition');
    const planId = `plan-${Date.now()}`;
    const decomposed = decomposePlan(plan, planId, processedGapIds);

    if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
      logger.info(
        `[PLANNER] Plan decomposed into ${decomposed.subTasks.length} sub-tasks. Dispatching via parallel.`
      );

      // Dispatch sub-tasks via parallel dispatch event
      const { emitTypedEvent: emitEvent } = await import('../lib/utils/typed-emit');
      const subTaskEvents = decomposed.subTasks.map((sub) => ({
        taskId: sub.subTaskId,
        agentId: AgentType.CODER,
        task: sub.task,
        metadata: { gapIds: sub.gapIds, subTaskId: sub.subTaskId, planId: sub.planId },
      }));

      await emitEvent(AgentType.STRATEGIC_PLANNER, EventType.PARALLEL_TASK_DISPATCH, {
        userId: baseUserId,
        tasks: subTaskEvents,
        barrierTimeoutMs: 30 * 60 * 1000, // 30 minutes
        aggregationType: 'summary' as const,
        traceId,
        initiatorId: AgentType.STRATEGIC_PLANNER,
        depth: (depth ?? 0) + 1,
        sessionId,
      });
    } else {
      // Single task dispatch (existing behavior)
      const { dispatchTask: dispatcher } = await import('../tools/knowledge/agent');
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
    }
  } else if (!isFailure && processedGapIds.length > 0) {
    logger.info('Evolution mode is hitl, asking for approval.');
    await sendOutboundMessage(
      AgentType.STRATEGIC_PLANNER,
      userId,
      `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${plan}\n\nReply with 'APPROVE' to execute.`,
      [baseUserId],
      sessionId,
      config.name,
      undefined
    );
  }

  return { gapId, plan, planId };
}
