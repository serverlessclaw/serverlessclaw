import { AgentType, AgentEvent, AgentPayload, TraceSource } from '../lib/types/agent';
import { ReasoningProfile } from '../lib/types/llm';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  extractBaseUserId,
  validatePayload,
  buildProcessOptions,
  initAgent,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { SWARM } from '../lib/constants';
import { RESEARCH_TASK_METADATA } from '../lib/schema/events';

/**
 * Technical Research Agent Handler.
 * Executes deep technical research by discovering patterns, reading docs,
 * and analyzing codebases using specialized MCP tools.
 *
 * Implements the 5-phase operational protocol: Discovery, Mapping, Analysis, Synthesis, Recommendation.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the agent's response string, or undefined on error.
 */
export const handler = async (event: AgentEvent, context: Context): Promise<string | undefined> => {
  logger.info('Researcher Agent received task:', JSON.stringify(event, null, 2));

  const payload = extractPayload<AgentPayload>(event);
  const { userId, task, metadata, traceId, sessionId, isContinuation, initiatorId, depth } =
    payload;

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);
  const isAggregation = task?.includes('[AGGREGATED_RESULTS]');

  // 1. Discovery & Initialization (config + context loaded in parallel)
  const { memory, agent } = await initAgent(AgentType.RESEARCHER);

  // 2. Swarm Self-Organization: Decompose high-level goals into parallel exploration
  if (!isAggregation && (depth ?? 0) < SWARM.MAX_RECURSIVE_DEPTH && task) {
    const { decomposePlan } = await import('../lib/agent/decomposer');
    const parentGapIds =
      (metadata?.gapIds as string[]) ?? (metadata?.coveredGapIds as string[]) ?? [];
    const decomposed = decomposePlan(
      task,
      payload.taskId || traceId || `plan-${Date.now()}`,
      parentGapIds,
      {
        defaultAgentId: AgentType.RESEARCHER,
        maxSubTasks: SWARM.DEFAULT_MAX_SUB_TASKS,
        minLength: 300,
      }
    );

    if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
      logger.info(
        `[RESEARCHER] Goal detected. Decomposing into ${decomposed.subTasks.length} parallel sub-tasks.`
      );

      const { emitTypedEvent } = await import('../lib/utils/typed-emit');
      const { EventType } = await import('../lib/types/agent');

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
          userId: baseUserId,
          tasks: subTaskEvents,
          barrierTimeoutMs: 10 * 60 * 1000, // 10 mins
          aggregationType: 'agent_guided',
          aggregationPrompt: `I have completed the parallel exploration for: "${task}". 
                             Synthesize the findings from these sub-tasks into a cohesive technical report. 
                             Focus on pattern discovery and actionable technical debt/gap identification.
                             Prepend the response with [AGGREGATED_RESULTS].`,
          initialQuery: task,
          traceId,
          initiatorId: AgentType.RESEARCHER,
          depth: (depth ?? 0) + 1,
          sessionId,
        });

        // Return a PAUSED signal
        return `TASK_PAUSED: Decomposed research goal into ${decomposed.subTasks.length} parallel sub-tasks.`;
      } catch (dispatchError) {
        logger.error(`[RESEARCHER] Failed to dispatch parallel tasks:`, dispatchError);
      }
    }
  }

  // 3. Execution
  const parsedMetadata = RESEARCH_TASK_METADATA.parse(metadata || {});
  const timeBudgetMs = parsedMetadata.timeBudgetMs ?? 600000;

  const processOptions = buildProcessOptions({
    isContinuation,
    isIsolated: true,
    initiatorId,
    depth,
    traceId,
    taskId: payload.taskId,
    sessionId,
    source: (payload.source as TraceSource) || TraceSource.UNKNOWN,
    context,
    taskTimeoutMs: timeBudgetMs,
    profile: ReasoningProfile.THINKING,
  });

  const startTime = Date.now();
  let finalResponseText: string;

  try {
    const result = await agent.process(userId, task || '', processOptions);
    finalResponseText = result?.responseText || '';

    // 4. Persistence: Store final synthesis as a granular memory item
    const existingFindings = await memory.searchInsights(
      userId,
      finalResponseText.substring(0, 100),
      undefined,
      1
    );

    const isDuplicate = existingFindings?.items.some(
      (item) => item.tags?.includes(traceId ?? '') || item.tags?.includes(payload.taskId ?? '')
    );

    if (!isDuplicate) {
      await memory.addMemory(userId, 'research_finding', finalResponseText, {
        category: 'research_finding',
        confidence: 9,
        impact: 5,
        tags: [traceId, payload.taskId, 'synthesis'].filter((t): t is string => !!t),
      });
    }

    // 5. Notification
    await emitTaskEvent({
      source: `${AgentType.RESEARCHER}.agent`,
      agentId: AgentType.RESEARCHER,
      userId: baseUserId,
      task: task || '',
      response: finalResponseText,
      traceId,
      taskId: payload.taskId,
      sessionId,
      initiatorId,
      depth,
      metadata: {
        durationMs: Date.now() - startTime,
        findingsCategory: 'research_finding',
      },
    });

    return finalResponseText;
  } catch (error) {
    logger.error(`[RESEARCHER] Task failed:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    await emitTaskEvent({
      source: `${AgentType.RESEARCHER}.agent`,
      agentId: AgentType.RESEARCHER,
      userId: baseUserId,
      task: task || '',
      error: `Research task failed: ${errorMsg}`,
      traceId,
      taskId: payload.taskId,
      sessionId,
      initiatorId,
      depth,
    });

    throw error;
  }
};
