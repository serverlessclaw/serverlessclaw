import { z } from 'zod';
import { BASE_EVENT_SCHEMA } from './base';
import { ParallelTaskStatus } from '../../types/constants';

/** Schema for parallel task dispatch events. */
export const PARALLEL_TASK_DISPATCH_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Array of sub-tasks to be executed in parallel. */
  tasks: z.array(
    z.object({
      taskId: z.string(),
      agentId: z.string(),
      task: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      dependsOn: z.array(z.string()).optional(),
    })
  ),
  /** The original query that triggered the parallelization. */
  initialQuery: z.string().optional(),
  /** Timeout for the entire parallel barrier. */
  barrierTimeoutMs: z.number().optional(),
  /** Strategy for aggregating sub-task results. */
  aggregationType: z.enum(['summary', 'agent_guided', 'merge_patches']).optional(),
  /** Custom prompt for result aggregation. */
  aggregationPrompt: z.string().optional(),
});

/** Schema for parallel task completion events. */
export const PARALLEL_TASK_COMPLETED_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Overall status of the parallel execution. */
  overallStatus: z.nativeEnum(ParallelTaskStatus),
  /** Individual results from each task. */
  results: z.array(
    z.object({
      taskId: z.string(),
      agentId: z.string(),
      status: z.string(),
      result: z.string().optional().nullable(),
      error: z.string().optional().nullable(),
      patch: z.string().optional().nullable(),
    })
  ),
  /** Total number of tasks dispatched. */
  taskCount: z.number(),
  /** Number of tasks that completed (successfully or otherwise). */
  completedCount: z.number(),
  /** Total duration in milliseconds. */
  elapsedMs: z.number().optional(),
  /** Aggregation strategy used. */
  aggregationType: z.enum(['summary', 'agent_guided', 'merge_patches']).optional(),
  /** Prompt used for aggregation. */
  aggregationPrompt: z.string().optional(),
});

/** Schema for parallel barrier timeout events. */
export const PARALLEL_BARRIER_TIMEOUT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the barrier that timed out. */
  barrierId: z.string(),
  /** Trace ID for correlation. */
  traceId: z.string(),
  /** List of task IDs that did not complete in time. */
  timedOutTasks: z.array(z.string()),
});
