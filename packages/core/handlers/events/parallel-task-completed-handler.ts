import { logger } from '../../lib/logger';
import { wakeupInitiator } from './shared';
import { AGENT_TYPES, EventType } from '../../lib/types/agent';
import { clearRecursionStack } from '../../lib/recursion-tracker';
import { PARALLEL_TASK_COMPLETED_EVENT_SCHEMA } from '../../lib/schema/events';
import { BaseMemoryProvider } from '../../lib/memory/base';
import { ProviderManager } from '../../lib/providers';
import { IMemory, ReasoningProfile, TraceSource } from '../../lib/types';

/**
 * Event handler for when all sub-tasks in a parallel dispatch are completed.
 * It aggregates results and wakes up the initiator.
 */
export async function handleParallelTaskCompleted(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const payload = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(eventDetail);
  const {
    userId,
    traceId,
    initiatorId,
    sessionId,
    depth,
    results,
    aggregationPrompt,
    aggregationType,
    workspaceId,
    teamId,
    staffId,
  } = payload;

  logger.info(`[PARALLEL] All sub-tasks completed for trace ${traceId}. Aggregating results.`);

  // 1. Specialized Aggregation: Procedural Patch Merge (Principle 10 & 11)
  if (aggregationType === 'merge_patches') {
    try {
      const { handlePatchMerge } = await import('./merger-handler');
      const mergeResult = await handlePatchMerge(payload as unknown as Record<string, unknown>);

      if (mergeResult.success || !mergeResult.failedPatches?.length) {
        logger.info(`[PARALLEL] Patch merge complete for ${traceId}.`);
        if (initiatorId) {
          await wakeupInitiator(
            userId,
            initiatorId,
            mergeResult.summary,
            traceId,
            sessionId,
            depth,
            false,
            undefined,
            traceId,
            EventType.CONTINUATION_TASK,
            workspaceId,
            teamId,
            staffId
          );
        }
        return;
      }

      // Tier 2 Fallback: If procedural merge fails, dispatch to a dedicated Merger agent
      logger.warn(
        `[PARALLEL] Procedural merge failed for ${traceId}. Falling back to MergerAgent.`
      );
      try {
        const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
        const { sendOutboundMessage } = await import('../../lib/outbound');

        await emitTypedEvent('events', EventType.MERGER_TASK as unknown as EventType, {
          userId,
          traceId,
          sessionId,
          workspaceId,
          teamId,
          staffId,
          depth: depth + 1,
          initiatorId: 'parallel-aggregator',
          task: `Resolve the following semantic conflicts in parallel patches:\n${mergeResult.summary}`,
          metadata: {
            failedPatches: mergeResult.failedPatches,
            originalInitiator: initiatorId,
          },
        });

        await sendOutboundMessage(
          'events',
          userId,
          `Merge Conflict Detected: Automated reconciliation failed for ${traceId}. A specialized Merger agent has been dispatched.`,
          [userId],
          sessionId,
          'System',
          undefined,
          undefined,
          undefined,
          workspaceId,
          teamId,
          staffId,
          undefined
        );
        return;
      } catch (dispatchError) {
        logger.error('[PARALLEL] MergerAgent dispatch failed:', dispatchError);
        const { sendOutboundMessage } = await import('../../lib/outbound');
        await sendOutboundMessage(
          'AgentBus',
          userId,
          `CRITICAL: Reconciliation Failed. Both procedural and agent-based merging failed for trace ${traceId}. Manual intervention required.`,
          [userId],
          sessionId,
          'System',
          undefined,
          undefined,
          undefined,
          workspaceId,
          teamId,
          staffId,
          undefined
        );
      }
    } catch (error) {
      logger.error('[PARALLEL] Patch merge error:', error);
    }
  }

  // 2. Specialized Aggregation: Agent-Guided Synthesis
  if (aggregationType === 'agent_guided' || aggregationPrompt) {
    try {
      const memory = new BaseMemoryProvider();
      const provider = new ProviderManager();

      const { AgentRegistry } = await import('../../lib/registry/AgentRegistry');
      const { getAgentTools } = await import('../../tools/index');
      const { SuperClaw } = await import('../../agents/superclaw');

      const config = await AgentRegistry.getAgentConfig(AGENT_TYPES.SUPERCLAW);
      const agentTools = await getAgentTools(AGENT_TYPES.SUPERCLAW);

      const aggregatorAgent = new SuperClaw(
        memory as unknown as IMemory,
        provider,
        agentTools,
        config
      );
      const prompt = `${aggregationPrompt || 'Synthesize the following task results into a coherent final response.'}\n\nHere are the individual task results:\n${JSON.stringify(results, null, 2)}`;

      const { responseText } = await aggregatorAgent.process(userId, prompt, {
        profile: ReasoningProfile.STANDARD,
        isIsolated: true,
        traceId,
        sessionId,
        workspaceId,
        teamId,
        staffId,
        source: TraceSource.SYSTEM,
      });

      logger.info(`Agent-guided aggregation complete for ${traceId}. Waking up initiator.`);
      if (initiatorId) {
        await wakeupInitiator(
          userId,
          initiatorId,
          responseText,
          traceId,
          sessionId,
          depth,
          false,
          undefined,
          traceId,
          EventType.CONTINUATION_TASK,
          workspaceId,
          teamId,
          staffId
        );
      }
      return;
    } catch (error) {
      logger.error('Failed to perform agent-guided aggregation, falling back to summary:', error);
    }
  }

  // 3. Baseline Fallback: Summary-based aggregation
  if (initiatorId) {
    const summary = results
      .map((r) => `Agent ${r.agentId} (${r.status}): ${r.result || r.error || 'No result'}`)
      .join('\n---\n');
    const aggregatedSummary = `[AGGREGATED_RESULTS]\n${summary}`;

    // Adjust target task type if needed (Principle 11 - Research Flow)
    const targetEventType =
      initiatorId === 'researcher' ? EventType.RESEARCH_TASK : EventType.CONTINUATION_TASK;

    await wakeupInitiator(
      userId,
      initiatorId,
      aggregatedSummary,
      traceId,
      sessionId,
      depth,
      false,
      undefined,
      traceId,
      targetEventType as unknown as EventType,
      workspaceId,
      teamId,
      staffId
    );
  }

  // Clear recursion stack to prevent DynamoDB storage growth
  if (traceId) {
    await clearRecursionStack(traceId).catch((err) =>
      logger.warn(`Failed to clear recursion stack for ${traceId}:`, err)
    );
  }
}
