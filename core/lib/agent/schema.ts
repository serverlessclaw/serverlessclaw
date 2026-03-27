import { ResponseFormat } from '../types/index';

/**
 * Standard structured output schema for agent coordination and deterministic state transitions.
 * This schema helps LLMs generate parseable JSON for tool orchestration.
 */
export const DEFAULT_SIGNAL_SCHEMA: ResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'agent_signal',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['SUCCESS', 'FAILED', 'CONTINUE', 'REOPEN'] },
        message: { type: 'string' },
        data: { type: 'object', additionalProperties: true },
        coveredGapIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'message'],
      additionalProperties: false,
    },
  },
};

/**
 * Result from a single agent task in a parallel execution.
 */
export interface AggregatedResult {
  taskId: string;
  agentId: string;
  status: 'success' | 'failed' | 'timeout';
  result?: unknown;
  durationMs: number;
  error?: string;
}

/**
 * Aggregated results from parallel agent dispatch.
 */
export interface MultiAgentResult {
  overallStatus: 'success' | 'partial' | 'failed';
  results: AggregatedResult[];
  timestamp: string;
}

/**
 * Schema for a single task in parallel dispatch.
 */
export interface ParallelTaskDefinition {
  taskId: string;
  agentId: string;
  task: string;
  metadata?: Record<string, unknown>;
  /** Task IDs that must complete before this task can start */
  dependsOn?: string[];
}

/**
 * Schema for parallel task dispatch parameters.
 */
export interface ParallelDispatchParams {
  tasks: ParallelTaskDefinition[];
  barrierTimeoutMs?: number;
  aggregationType?: 'summary' | 'agent_guided';
  aggregationPrompt?: string;
  /** Enable dependency-aware execution (DAG mode) */
  enableDependencies?: boolean;
}

/**
 * Schema for task cancellation.
 */
export interface TaskCancellation {
  taskId: string;
  initiatorId: string;
  reason?: string;
}
