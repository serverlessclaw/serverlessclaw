import { Agent } from '../../lib/agent';
import { AgentType, EventType, TraceSource } from '../../lib/types/agent';
import { IAgentConfig, ReasoningProfile } from '../../lib/types/index';
import { logger } from '../../lib/logger';
import { getAgentContext, loadAgentConfig } from '../../lib/utils/agent-helpers';
import { RESEARCH_TASK_METADATA } from '../../lib/schema/events';
import { SWARM } from '../../lib/constants';

/**
 * Technical Research Agent Handler.
 * Executes deep technical research by discovering patterns, reading docs,
 * and analyzing codebases using specialized MCP tools.
 */
export async function handleResearchTask(eventDetail: Record<string, unknown>): Promise<void> {
  const {
    userId,
    taskId,
    task,
    metadata = {},
    traceId,
    initiatorId,
    depth = 0,
    sessionId,
  } = eventDetail as any;

  const isAggregation = task.includes('[AGGREGATED_RESULTS]');

  // 2. Self-Organization: Decompose high-level goals into parallel exploration
  if (!isAggregation && (depth ?? 0) < SWARM.MAX_RECURSIVE_DEPTH) {
    const { decomposePlan } = await import('../../lib/agent/decomposer');
    const parentGapIds =
      (metadata?.gapIds as string[]) ?? (metadata?.coveredGapIds as string[]) ?? [];
    const decomposed = decomposePlan(task, taskId, parentGapIds, {
      defaultAgentId: AgentType.RESEARCHER,
      maxSubTasks: SWARM.DEFAULT_MAX_SUB_TASKS,
      minLength: 300,
    });

    if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
      logger.info(
        `[RESEARCHER] Goal detected. Decomposing into ${decomposed.subTasks.length} parallel sub-tasks.`
      );

      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
      const subTaskEvents = decomposed.subTasks.map((sub) => ({
        taskId: sub.subTaskId,
        agentId: sub.agentId,
        task: sub.task,
        metadata: {
          ...metadata,
          traceId: traceId ?? sub.planId,
          subTaskId: sub.subTaskId,
          planId: sub.planId,
        },
      }));

      try {
        await emitTypedEvent(AgentType.RESEARCHER, EventType.PARALLEL_TASK_DISPATCH, {
          userId,
          tasks: subTaskEvents,
          barrierTimeoutMs: 300000,
          aggregationType: 'agent_guided',
          aggregationPrompt: `I have completed the parallel exploration for: "${task}". 
                             Synthesize the findings from these sub-tasks into a cohesive technical report. 
                             Focus on pattern discovery and actionable technical debt/gap identification.
                             Prepend the response with [AGGREGATED_RESULTS].`,
          traceId,
          initiatorId: AgentType.RESEARCHER,
          depth: (depth ?? 0) + 1,
          sessionId,
        });
      } catch (dispatchError) {
        logger.error(`[RESEARCHER] Failed to dispatch parallel tasks:`, dispatchError);
        const { emitTaskFailed } = await import('../../lib/utils/typed-emit');
        await emitTaskFailed(AgentType.RESEARCHER, {
          userId,
          agentId: AgentType.RESEARCHER,
          task,
          error: `Parallel dispatch failed: ${dispatchError instanceof Error ? dispatchError.message : String(dispatchError)}`,
          traceId,
          initiatorId: initiatorId ?? AgentType.STRATEGIC_PLANNER,
          depth: (depth ?? 0) + 1,
          sessionId,
        });
        return;
      }

      return;
    }
  }

  // 3. Setup Agent for processing (Synthesis or Single Task)
  const [{ memory, provider: providerManager }, { getAgentTools }] = await Promise.all([
    getAgentContext(),
    import('../../tools/index'),
  ]);
  const config = (await loadAgentConfig(AgentType.RESEARCHER)) as IAgentConfig;
  const tools = await getAgentTools(AgentType.RESEARCHER);
  const researcherTools = tools.filter((t: any) => config.tools?.includes(t.name));

  const researcher = new Agent(
    memory,
    providerManager,
    researcherTools,
    config.systemPrompt,
    config
  );

  // 4. Budget enforcement
  const parsedMetadata = RESEARCH_TASK_METADATA.parse(metadata);
  const _tokenBudget = parsedMetadata.tokenBudget ?? 100000;
  const timeBudgetMs = parsedMetadata.timeBudgetMs ?? 300000; // 5 mins

  logger.info(`[RESEARCHER] Starting research ${isAggregation ? 'synthesis' : 'task'} ${taskId}`);

  const startTime = Date.now();

  try {
    // 5. Execute processing
    const result = await researcher.process(userId, task, {
      profile: ReasoningProfile.THINKING,
      isIsolated: true,
      initiatorId: initiatorId ?? AgentType.STRATEGIC_PLANNER,
      depth,
      traceId,
      taskId,
      sessionId,
      source: TraceSource.SYSTEM,
      taskTimeoutMs: timeBudgetMs,
    });

    // 6. Persistence: Intermediate findings are already handled by TOOL_SAVE_MEMORY
    // and researcher.md phrasing. We store the final synthesis as a granular memory item.
    // Deduplicate by checking if similar finding already exists for this trace
    const existingFindings = await memory.searchInsights(
      userId,
      result.responseText.substring(0, 100),
      undefined,
      1
    );

    const isDuplicate = existingFindings?.items.some(
      (item) => item.tags?.includes(traceId ?? '') || item.tags?.includes(taskId ?? '')
    );

    if (isDuplicate) {
      logger.info(`[RESEARCHER] Skipping duplicate memory storage for trace ${traceId}`);
    } else {
      await memory.addMemory(userId, 'research_finding', result.responseText, {
        category: 'research_finding',
        confidence: 9,
        impact: 5,
        complexity: 1,
        risk: 1,
        urgency: 1,
        priority: 5,
        tags: [traceId, taskId, 'synthesis'],
      } as any);
    }

    // 7. Emit completion
    const { emitTaskCompleted } = await import('../../lib/utils/typed-emit');
    await emitTaskCompleted(AgentType.RESEARCHER, {
      userId,
      agentId: AgentType.RESEARCHER,
      task,
      response: result.responseText,
      traceId,
      initiatorId: initiatorId ?? AgentType.STRATEGIC_PLANNER,
      depth: (depth ?? 0) + 1,
      sessionId,
      metadata: {
        durationMs: Date.now() - startTime,
        findingsCategory: 'research_finding',
      },
    });

    logger.info(`[RESEARCHER] Task ${taskId} completed successfully.`);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[RESEARCHER] Task ${taskId} failed:`, error);

    const { emitTaskFailed } = await import('../../lib/utils/typed-emit');
    await emitTaskFailed(AgentType.RESEARCHER, {
      userId,
      agentId: AgentType.RESEARCHER,
      task,
      error: `Research task failed after ${Date.now() - startTime}ms: ${errorMsg}`,
      traceId,
      initiatorId: initiatorId ?? AgentType.STRATEGIC_PLANNER,
      depth: (depth ?? 0) + 1,
      sessionId,
    });
  }
}
