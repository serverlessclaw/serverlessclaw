import { logger } from '../../lib/logger';
import { wakeupInitiator } from './shared';
import { AgentType, EventType } from '../../lib/types/agent';
import { clearRecursionStack } from '../../lib/recursion-tracker';

interface ParallelTaskCompletedEvent {
  userId: string;
  sessionId?: string;
  traceId?: string;
  initiatorId?: string;
  overallStatus: 'success' | 'partial' | 'failed' | 'timed_out';
  results: Array<{
    taskId: string;
    agentId: string;
    status: string;
    result?: string | null;
    error?: string | null;
    patch?: string | null;
  }>;
  taskCount: number;
  completedCount: number;
  elapsedMs?: number;
  aggregationType?: 'summary' | 'agent_guided' | 'merge_patches';
  aggregationPrompt?: string;
  depth?: number;
}

/**
 * Handles PARALLEL_TASK_COMPLETED events by waking up the initiator
 * with a formatted summary of the aggregated parallel dispatch results.
 *
 * @param eventDetail - The detail of the EventBridge event.
 */
export async function handleParallelTaskCompleted(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const {
    userId,
    sessionId,
    traceId,
    initiatorId,
    overallStatus,
    results,
    taskCount,
    completedCount,
    elapsedMs,
    aggregationType,
    aggregationPrompt,
    depth = 0,
  } = eventDetail as unknown as ParallelTaskCompletedEvent;

  if (!initiatorId) {
    logger.info(
      `Parallel dispatch completed but no initiatorId provided. TraceId: ${traceId ?? 'N/A'}`
    );
    return;
  }

  const statusEmoji =
    overallStatus === 'success' ? '✅' : overallStatus === 'partial' ? '⚠️' : '❌';

  const successCount = results.filter((r) => r.status === 'success').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const timeoutCount = results.filter((r) => r.status === 'timed_out').length;

  // Build per-task summary
  const taskSummaries = results
    .map((r) => {
      const icon = r.status === 'success' ? '✅' : r.status === 'failed' ? '❌' : '⏰';
      const resultSnippet = r.result
        ? r.result.substring(0, 200)
        : r.error
          ? `Error: ${r.error.substring(0, 200)}`
          : 'No result';
      return `${icon} ${r.agentId} (${r.taskId}): ${resultSnippet}`;
    })
    .join('\n');

  const summary = [
    `${statusEmoji} **Parallel Dispatch Complete** (${overallStatus.toUpperCase()})`,
    `Tasks: ${completedCount}/${taskCount} completed | ✅ ${successCount} succeeded | ❌ ${failedCount} failed | ⏰ ${timeoutCount} timed out${elapsedMs ? ` | ⏱️ ${Math.round(elapsedMs / 1000)}s` : ''}`,
    '',
    '**Results:**',
    taskSummaries,
  ].join('\n');

  if (aggregationType === 'merge_patches') {
    logger.info(`Parallel dispatch ${traceId ?? 'N/A'} requesting patch merge.`);
    try {
      const { handlePatchMerge } = await import('./merger-handler');
      const mergeResult = await handlePatchMerge(eventDetail);

      if (mergeResult.success) {
        logger.info(`Procedural merge succeeded for ${traceId}. Waking up initiator.`);
        await wakeupInitiator(
          userId,
          initiatorId,
          mergeResult.summary,
          traceId,
          sessionId,
          depth + 1,
          false,
          undefined,
          traceId
        );
        return;
      }

      // Procedural merge failed with conflicts - Tier 2: LLM Reconciliation
      logger.info(
        `Procedural merge failed with ${mergeResult.failedPatches.length} conflicts. Dispatching to MergerAgent for LLM reconciliation.`
      );

      try {
        const { emitTypedEvent } = await import('../../lib/utils/typed-emit');

        // Dispatch to LLM MergerAgent
        await emitTypedEvent(AgentType.EVENT_HANDLER, EventType.MERGER_TASK, {
          userId,
          task: `Resolve the following semantic conflicts between parallel code changes:\n\n${mergeResult.failedPatches.map((f) => `Task ${f.taskId} (Agent: ${f.agentId}): ${f.error}`).join('\n')}`,
          metadata: {
            results: eventDetail.results, // Pass full results including patches
            failedPatches: mergeResult.failedPatches,
            appliedPatches: mergeResult.appliedPatches,
            aggregationPrompt,
          },
          traceId,
          sessionId,
          initiatorId,
          depth: 2,
        });

        // Notify user that intelligent reconciliation is in progress
        const { sendOutboundMessage } = await import('../../lib/outbound');
        await sendOutboundMessage(
          AgentType.EVENT_HANDLER,
          userId,
          `⚠️ **Merge Conflict Detected**\n\nA simple git-merge failed for some parallel changes. I am now invoking the **Structural Merger Agent** to perform AST-aware reconciliation.\n\nConflicts in:\n${mergeResult.failedPatches.map((f) => `- ${f.agentId} (${f.taskId})`).join('\n')}`,
          [userId.replace('CONV#', '')],
          sessionId,
          'System'
        );

        return;
      } catch (dispatchError) {
        logger.error('Failed to dispatch MergerAgent for reconciliation:', dispatchError);
        const { sendOutboundMessage } = await import('../../lib/outbound');
        await sendOutboundMessage(
          'AgentBus',
          userId,
          `❌ **Reconciliation Failed**\n\nI encountered conflicts while merging parallel changes and failed to start the reconciliation agent. Falling back to simple summary.`,
          [userId.replace('CONV#', '')],
          sessionId,
          'System'
        );
        // Fall through to summary
      }
    } catch (error) {
      logger.error('Failed to perform patch merge, falling back to summary:', error);
    }
  }

  if (aggregationType === 'agent_guided') {
    logger.info(`Parallel dispatch ${traceId ?? 'N/A'} requesting agent-guided aggregation.`);

    // If the initiator is the Researcher, we route back to the researcher-handler
    // to allow it to perform its own specialized synthesis and memory storage.
    if (initiatorId === AgentType.RESEARCHER) {
      logger.info(
        `Routing researcher aggregation back to research-handler for specialized synthesis.`
      );
      const resultsSummary = `[AGGREGATED_RESULTS]\nI have completed the parallel exploration. Here are the results from the ${taskCount} sub-tasks:\n\n${taskSummaries}`;
      await wakeupInitiator(
        userId,
        initiatorId,
        resultsSummary,
        traceId,
        sessionId,
        depth + 1,
        false,
        undefined,
        traceId, // taskId
        EventType.RESEARCH_TASK
      );
      return;
    }

    try {
      const { Agent } = await import('../../lib/agent');
      const { getAgentContext, loadAgentConfig } = await import('../../lib/utils/agent-helpers');
      const { TraceSource } = await import('../../lib/types/agent');
      const { ReasoningProfile } = await import('../../lib/types/llm');

      // 2026 fix: use the actual initiatorId for aggregation if it's a valid agent
      let config;
      try {
        config = await loadAgentConfig(initiatorId as string);
      } catch {
        config = await loadAgentConfig(AgentType.SUPERCLAW);
      }
      const { memory, provider: providerManager } = await getAgentContext();

      // Simple aggregator doesn't need tools, just reasoning
      const aggregatorAgent = new Agent(memory, providerManager, [], config.systemPrompt, config);

      const prompt =
        aggregationPrompt ??
        `I have completed a parallel dispatch of ${taskCount} tasks. Here are the results:
        
        ${taskSummaries}
        
        Please synthesize these results. 
        - If tasks succeeded: Provide a cohesive summary and determine the next logical action.
        - If many tasks failed or timed out: Analyze the errors, identify common bottlenecks, and provide a concrete RECOVERY PLAN to achieve the original goal.
        
        Return your response as a clear recommendation for the user or the next task to be executed.`;

      const { responseText } = await aggregatorAgent.process(userId, prompt, {
        profile: ReasoningProfile.STANDARD,
        isIsolated: true,
        traceId,
        sessionId,
        source: TraceSource.SYSTEM,
      });

      logger.info(`Agent-guided aggregation complete for ${traceId}. Waking up initiator.`);
      await wakeupInitiator(
        userId,
        initiatorId,
        responseText,
        traceId,
        sessionId,
        depth + 1,
        false,
        undefined,
        traceId
      );
      return;
    } catch (error) {
      logger.error('Failed to perform agent-guided aggregation, falling back to summary:', error);
    }
  }

  const aggregatedSummary = `[AGGREGATED_RESULTS]\n${summary}`;
  await wakeupInitiator(
    userId,
    initiatorId,
    aggregatedSummary,
    traceId,
    sessionId,
    depth + 1,
    false,
    undefined,
    traceId
  );

  // Clear recursion stack to prevent DynamoDB storage growth
  if (traceId) {
    await clearRecursionStack(traceId).catch((err) =>
      logger.warn(`Failed to clear recursion stack for ${traceId}:`, err)
    );
  }
}
