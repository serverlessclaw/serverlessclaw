import { logger } from '../logger';
import { AgentType, EventType, AgentPayload } from '../types/agent';
import { SWARM, SYSTEM } from '../constants/system';
import { isTaskPaused } from '../utils/agent-helpers';
import { ConfigManager } from '../registry/config';
import { parseConfigInt } from '../providers/utils';
import { DYNAMO_KEYS } from '../constants';

async function getMaxRecursionDepth(): Promise<number> {
  try {
    const custom = await ConfigManager.getRawConfig(DYNAMO_KEYS.RECURSION_LIMIT);
    if (custom !== undefined) {
      return parseConfigInt(custom, SYSTEM.DEFAULT_RECURSION_LIMIT);
    }
  } catch {
    // Use default on config fetch error
  }
  return SYSTEM.DEFAULT_RECURSION_LIMIT;
}

/**
 * Options for swarm decomposition.
 */
export interface SwarmDecompositionOptions {
  /** Trace ID for the current execution. */
  traceId: string;
  /** Session ID for the current execution. */
  sessionId?: string;
  /** Current recursion depth. */
  depth?: number;
  /** Whether this is a continuation of a previous task. */
  isContinuation?: boolean;
  /** Whether this is an aggregation of parallel results. */
  isAggregation?: boolean;
  /** Default agent to assign sub-tasks to (usually CODER). */
  defaultAgentId?: AgentType;
  /** Maximum number of sub-tasks to generate. */
  maxSubTasks?: number;
  /** Minimum length of text to trigger decomposition (default: 800). */
  minLength?: number;
  /** Barrier timeout for parallel execution (ms). */
  barrierTimeoutMs?: number;
  /** Aggregation strategy for results. */
  aggregationType?: string;
  /** Custom prompt for result aggregation. */
  aggregationPrompt?: string;
  /** Associated capability gaps (locked). */
  lockedGapIds?: string[];
  /** Initiator of the task. */
  initiatorId?: string;
  /** Source agent initiating the swarm. */
  sourceAgentId?: string;
}

/**
 * Unified Swarm Orchestrator
 *
 * Consolidates fragmented decomposition and parallel dispatch logic into a
 * shared service. This ensures consistent swarm behavior across all agent
 * types (Streaming, System, and Dynamic).
 */
export async function handleSwarmDecomposition(
  responseText: string,
  payload: AgentPayload,
  options: SwarmDecompositionOptions
): Promise<{ wasDecomposed: boolean; isPaused: boolean; response: string }> {
  const {
    traceId,
    sessionId,
    depth = 0,
    isContinuation = false,
    isAggregation = false,
    defaultAgentId = AgentType.CODER,
    maxSubTasks = SWARM.DEFAULT_MAX_SUB_TASKS,
    minLength = 800,
    barrierTimeoutMs = SWARM.DEFAULT_BARRIER_TIMEOUT_MS,
    aggregationType,
    aggregationPrompt,
    lockedGapIds = [],
    initiatorId,
    sourceAgentId,
  } = options;

  const isPaused = isTaskPaused(responseText);
  const hasMissionMarkers = responseText.includes('### Goal:') || responseText.includes('### Step');

  const maxDepth = await getMaxRecursionDepth();

  // Guard: Only decompose if not paused, not too deep, and contains mission intent
  if (
    !isContinuation &&
    !isAggregation &&
    !isPaused &&
    depth < maxDepth &&
    (hasMissionMarkers || responseText.length > minLength)
  ) {
    const { decomposePlan } = await import('./decomposer');
    const decomposed = decomposePlan(responseText, traceId || `plan-${Date.now()}`, [], {
      defaultAgentId,
      maxSubTasks,
      minLength,
    });

    if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
      logger.info(
        `[SwarmOrchestrator] Decomposing plan into ${decomposed.subTasks.length} parallel tasks (depth: ${depth}).`
      );

      const { emitTypedEvent } = await import('../utils/typed-emit');

      const subTaskEvents = decomposed.subTasks.map((sub) => ({
        taskId: sub.subTaskId,
        agentId: sub.agentId,
        task: sub.task,
        userId: payload.userId,
        sessionId,
        traceId,
        initiatorId: payload.initiatorId,
        depth: depth + 1,
        isParallel: true,
        metadata: {
          ...payload.metadata,
          originalPlan: responseText,
          subTaskIndex: sub.subTaskId,
          totalSubTasks: decomposed.subTasks.length,
          gapIds: sub.gapIds,
        },
      }));

      await emitTypedEvent(sourceAgentId || defaultAgentId, EventType.PARALLEL_TASK_DISPATCH, {
        dispatchId: traceId,
        tasks: subTaskEvents,
        barrierTimeoutMs,
        aggregationType,
        aggregationPrompt,
        userId: payload.userId,
        sessionId,
        traceId,
        initiatorId: initiatorId || payload.initiatorId,
        depth,
        metadata: {
          lockedGapIds,
        },
      });

      const pausedResponse = `TASK_PAUSED: I have decomposed this mission into ${decomposed.subTasks.length} parallel sub-tasks. I will notify you once the swarm completes the execution and I've synthesized the results.`;

      return { wasDecomposed: true, isPaused: true, response: pausedResponse };
    }
  }

  return { wasDecomposed: false, isPaused, response: responseText };
}
