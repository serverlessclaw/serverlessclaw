import { logger } from '../../lib/logger';
import { AgentType, EventType, EvolutionMode } from '../../lib/types/agent';
import { InsightCategory, IMemory } from '../../lib/types/memory';
import { MessageRole } from '../../lib/types/llm';
import { sendOutboundMessage } from '../../lib/outbound';
import { randomUUID } from 'node:crypto';
import { isTaskPaused } from '../../lib/utils/agent-helpers';
import { emitTaskEvent } from '../../lib/utils/agent-helpers/event-emitter';
import { normalizeGapId } from '../../lib/memory/utils';
import { TRACE_TYPES, INSIGHT_DEFAULTS } from '../../lib/constants';
import { recordCooldown } from './evolution';
import { PlannerResult } from './types';
import { validatePlan } from './validation';
import type { TrackStore } from '../../lib/memory/gap-operations';

/**
 * Interface for post-processing options.
 */
interface PostProcessingOptions {
  plan: string;
  planId: string;
  status: string;
  coveredGapIds: string[];
  toolOptimizations: Array<{ action: string; toolName: string; reason: string }>;
  structuredTasks?: Array<{ agentId: string; task: string; gapIds: string[] }>;
  isFailure: boolean;
  userId: string;
  sessionId: string;
  traceId: string;
  initiatorId: string;
  depth: number;
  gapId?: string;
  task: string;
  isScheduledReview: boolean;
  config: { name: string };
  metadata: Record<string, unknown>;
}

/**
 * Handles all post-plan-generation tasks like notifications, event emission,
 * gap state updates, and Council review dispatch.
 */
export async function postProcessPlan(
  memory: IMemory,
  options: PostProcessingOptions
): Promise<PlannerResult> {
  const {
    plan,
    planId,
    status,
    coveredGapIds,
    toolOptimizations,
    structuredTasks,
    isFailure,
    userId,
    sessionId,
    traceId,
    initiatorId,
    depth,
    gapId,
    task,
    isScheduledReview,
    config,
    metadata,
  } = options;

  const { extractBaseUserId } = await import('../../lib/utils/agent-helpers');
  const baseUserId = extractBaseUserId(userId);

  const lockedCoveredGapIds: string[] = [];

  try {
    if (!isFailure && status === 'SUCCESS') {
      const { addTraceStep } = await import('../../lib/utils/trace-helper');
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
      await Promise.all(
        toolOptimizations.map(async (opt) => {
          const toolGapId = randomUUID();
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
        })
      );
    }

    const postProcessingPromises: Promise<unknown>[] = [];

    // 1. Notify user directly in the chat session ONLY if successful and not empty
    if (!isFailure && plan !== 'Empty response from OpenAI.') {
      postProcessingPromises.push(
        sendOutboundMessage(
          AgentType.STRATEGIC_PLANNER,
          userId,
          plan.startsWith('🚀') ? plan : `🚀 **Strategic Plan Generated**\n\n${plan}`,
          undefined,
          sessionId,
          config.name,
          [], // attachments
          traceId ? `${traceId}-${AgentType.STRATEGIC_PLANNER}` : undefined,
          [
            { label: 'Approve', value: `APPROVE ${planId}` },
            { label: 'Clarify', value: `CLARIFY ${planId}` },
            { label: 'Dismiss', value: `DISMISS ${planId}`, type: 'secondary' as const },
          ]
        )
      );
    }

    // 2. Emit Task Result for Universal Coordination
    if (!isTaskPaused(plan)) {
      postProcessingPromises.push(
        emitTaskEvent({
          source: AgentType.STRATEGIC_PLANNER,
          userId: baseUserId,
          agentId: AgentType.STRATEGIC_PLANNER,
          task: isScheduledReview ? 'Scheduled Review' : task,
          response: plan,
          error: isFailure ? plan : undefined,
          traceId,
          initiatorId,
          depth,
          sessionId,
          userNotified: !isFailure,
        })
      );
    }

    // 4. Record gap in structured cooldown store
    if (gapId && !isFailure) {
      postProcessingPromises.push(recordCooldown(memory, gapId, baseUserId));
    }

    // 5. Gap Sink: Mark covered gaps as PLANNED + assign to tracks
    const processedGapIds: string[] = [];
    if (!isFailure) {
      const { assignGapToTrack, determineTrack } = await import('../../lib/memory/gap-operations');
      const track = determineTrack(plan);

      if (isScheduledReview || coveredGapIds.length > 0) {
        logger.info(`Marking ${coveredGapIds.length} gaps as PLANNED based on structured output.`);

        // Acquire locks for all covered gaps before updating (race condition fix)
        const lockResults = await Promise.all(
          coveredGapIds.map(async (gId) => {
            const numericId = normalizeGapId(gId);
            const acquired = await memory.acquireGapLock(numericId, AgentType.STRATEGIC_PLANNER);
            if (acquired) {
              lockedCoveredGapIds.push(numericId);
            }
            return { numericId, acquired };
          })
        );

        // P1 Fix: Check if any locks failed - if so, rollback all acquired locks
        const allAcquired = lockResults.every(({ acquired }) => acquired);
        if (!allAcquired) {
          logger.warn(
            `[PLANNER] Partial lock failure for ${coveredGapIds.length} gaps. Rolling back.`
          );
          await Promise.all(
            lockedCoveredGapIds.map(async (lockedId) => {
              try {
                await memory.releaseGapLock(lockedId, AgentType.STRATEGIC_PLANNER);
              } catch (e) {
                logger.warn(`[PLANNER] Failed to release lock for gap ${lockedId}:`, e);
              }
            })
          );
          lockedCoveredGapIds.length = 0;
        }

        const results = await Promise.all(
          lockResults
            .filter(({ acquired }) => acquired)
            .map(async ({ numericId }) => {
              await assignGapToTrack(memory as unknown as TrackStore, numericId, track);
              return numericId;
            })
        );

        processedGapIds.push(...results);
      } else if (gapId) {
        logger.info(`Marking specific gap ${gapId} as PLANNED after design.`);
        await assignGapToTrack(memory as unknown as TrackStore, gapId, track);
        processedGapIds.push(gapId);
      }
    }

    // 6. Save plan for QA auditing and HITL resolution
    for (const gapIdToSave of processedGapIds) {
      postProcessingPromises.push(memory.updateDistilledMemory(`PLAN#${gapIdToSave}`, plan));
    }
    postProcessingPromises.push(
      memory.updateDistilledMemory(
        `PLAN#${planId}`,
        JSON.stringify({ plan, gapIds: processedGapIds })
      )
    );

    await Promise.all(postProcessingPromises);

    const { getEvolutionMode } = await import('./evolution');
    const evolutionMode = await getEvolutionMode();

    // Council of Agents: Check if plan requires peer review
    const COUNCIL_THRESHOLD = 8;
    const gapImpact = (metadata.impact as number) ?? 0;
    const gapRisk = (metadata.risk as number) ?? 0;
    const gapComplexity = (metadata.complexity as number) ?? 0;
    const requiresCouncil =
      gapImpact >= COUNCIL_THRESHOLD ||
      gapRisk >= COUNCIL_THRESHOLD ||
      gapComplexity >= COUNCIL_THRESHOLD;

    // P1 Fix: In HITL mode, skip Council and ask human directly first
    // Council can be triggered later after human approval if needed
    if (
      requiresCouncil &&
      !isFailure &&
      processedGapIds.length > 0 &&
      evolutionMode === EvolutionMode.AUTO
    ) {
      logger.info(
        `[PLANNER] Plan requires Council review (Auto mode). Dispatching parallel critic tasks.`
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

      await memory.addMessage(collaboration.syntheticUserId, {
        role: MessageRole.ASSISTANT,
        content: `### COUNCIL REVIEW REQUEST: ${planId}\n\n**Strategic Plan:**\n${plan}\n\n**Context:**\nImpact: ${gapImpact} | Risk: ${gapRisk} | Complexity: ${gapComplexity}\n\nPlease provide your expert feedback and verdict (APPROVED/REJECTED/CONDITIONAL).`,
        agentName: AgentType.STRATEGIC_PLANNER,
        traceId,
        messageId: `council-${planId}-${Date.now()}`,
      });

      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
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
        barrierTimeoutMs: 120000,
        aggregationType: 'agent_guided' as const,
        aggregationPrompt: `Synthesize the Council discussion in session ${collaborationId} and the individual reviews for Plan ${planId}. Return your response starting with [COUNCIL_REVIEW_RESULT] followed by VERDICT: <APPROVED|REJECTED|CONDITIONAL> and a summary of findings. If all reviews are APPROVED, return VERDICT: APPROVED. If ANY review has verdict REJECTED, return VERDICT: REJECTED with consolidated feedback. Always include the Plan ID ${planId} and Collaboration ID ${collaborationId} in your response.`,
        traceId: councilTraceId,
        initiatorId: AgentType.STRATEGIC_PLANNER,
        depth: depth ?? 0,
        sessionId,
      });

      const councilPlanKey = `TEMP#COUNCIL_PLAN#${councilTraceId}`;
      const councilPlanValue = JSON.stringify({
        plan,
        gapIds: processedGapIds,
        userId: baseUserId,
        sessionId,
        traceId: councilTraceId,
        planId,
        collaborationId,
      });
      await memory.updateDistilledMemory(councilPlanKey, councilPlanValue);
      return { gapId, plan, planId, status: 'COUNCIL_DISPATCHED' };
    } else if (evolutionMode === EvolutionMode.AUTO && !isFailure && processedGapIds.length > 0) {
      const validation = validatePlan(plan, processedGapIds);
      if (!validation.isValid) {
        logger.warn(`[PLANNER] Plan validation failed: ${validation.reason}. Skipping dispatch.`);
        await sendOutboundMessage(
          AgentType.STRATEGIC_PLANNER,
          userId,
          `⚠️ **Plan Validation Failed**\n\nThe generated plan did not pass validation: ${validation.reason}\n\nPlease review and try again.`,
          undefined,
          sessionId,
          config.name
        );
        return { gapId, plan, planId, status: 'PLAN_VALIDATION_FAILED' };
      }

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

      let decomposed;
      if (structuredTasks && structuredTasks.length > 0) {
        decomposed = {
          wasDecomposed: true,
          subTasks: structuredTasks.map((st, i) => ({
            subTaskId: `${planId}-sub-${i}`,
            planId,
            task: st.task,
            gapIds: st.gapIds,
            order: i,
            dependencies: [] as number[],
            complexity: 5,
            agentId: st.agentId,
          })),
        };
      } else {
        const { decomposePlan } = await import('../../lib/agent/decomposer');
        decomposed = await decomposePlan(plan, planId, processedGapIds, {
          maxSubTasks: 3,
        });
      }

      if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
        const { emitTypedEvent: emitEvent } = await import('../../lib/utils/typed-emit');
        const subTaskEvents = decomposed.subTasks.map((sub) => ({
          taskId: sub.subTaskId,
          agentId: sub.agentId,
          task: sub.task,
          metadata: { gapIds: sub.gapIds, subTaskId: sub.subTaskId, planId: sub.planId },
          dependsOn: sub.dependencies.map((depIndex) => decomposed.subTasks[depIndex].subTaskId),
        }));

        await emitEvent(AgentType.STRATEGIC_PLANNER, EventType.PARALLEL_TASK_DISPATCH, {
          userId: baseUserId,
          tasks: subTaskEvents,
          barrierTimeoutMs: 30 * 60 * 1000,
          aggregationType: subTaskEvents.some((t) => t.agentId === AgentType.RESEARCHER)
            ? ('agent_guided' as const)
            : subTaskEvents.every((t) => t.agentId === AgentType.CODER)
              ? ('merge_patches' as const)
              : ('summary' as const),
          aggregationPrompt: subTaskEvents.some((t) => t.agentId === AgentType.RESEARCHER)
            ? `I have received findings from parallel research tasks. Please synthesize these into a comprehensive technical report. 
               Identify overarching patterns, cross-repo dependencies, and specific implementation gaps. 
               The goal is to inform the next phase of development for: "${plan.substring(0, 500)}..."`
            : undefined,
          traceId,
          initiatorId: AgentType.STRATEGIC_PLANNER,
          depth: depth ?? 0,
          sessionId,
        });
      } else {
        const { dispatchTask: dispatcher } = await import('../../tools/knowledge/agent');
        const targetAgent = decomposed.subTasks[0]?.agentId || AgentType.CODER;

        await dispatcher.execute({
          agentId: targetAgent,
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
  } finally {
    for (const coveredId of lockedCoveredGapIds) {
      try {
        await memory.releaseGapLock(coveredId, AgentType.STRATEGIC_PLANNER);
      } catch (e) {
        logger.warn(`Failed to release covered gap lock for ${coveredId}:`, e);
      }
    }
  }
}
