/**
 * Trace types for ClawTracer instrumentation.
 */
export enum TraceType {
  LLM_CALL = 'llm_call',
  LLM_RESPONSE = 'llm_response',
  TOOL_CALL = 'tool_call',
  TOOL_RESPONSE = 'tool_result',
  REFLECT = 'reflect',
  EMIT = 'emit',
  BRIDGE = 'bridge',
  ERROR = 'error',
  // Agent Communication patterns
  CLARIFICATION_REQUEST = 'clarification_request',
  CLARIFICATION_RESPONSE = 'clarification_response',
  PARALLEL_DISPATCH = 'parallel_dispatch',
  PARALLEL_BARRIER = 'parallel_barrier',
  PARALLEL_COMPLETED = 'parallel_completed',
  COUNCIL_REVIEW = 'council_review',
  CONTINUATION = 'continuation',
  COLLABORATION_STARTED = 'collaboration_started',
  COLLABORATION_COMPLETED = 'collaboration_completed',
  COLLABORATION_MESSAGE = 'collaboration_message',
  // System Events
  CIRCUIT_BREAKER = 'circuit_breaker',
  CANCELLATION = 'cancellation',
  MEMORY_OPERATION = 'memory_operation',
  // Agent State
  AGENT_WAITING = 'agent_waiting',
  AGENT_RESUMED = 'agent_resumed',
  // Agent Activity
  PLAN_GENERATED = 'plan_generated',
  CODE_WRITTEN = 'code_written',
  REVIEW_COMPLETE = 'review_complete',
  AUDIT_COMPLETE = 'audit_complete',
  AGGREGATION_COMPLETE = 'aggregation_complete',
}

/**
 * Status values for traces.
 */
export enum TraceStatus {
  STARTED = 'started',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
}

/**
 * Optimization policies for system-wide reasoning depth.
 */
export enum OptimizationPolicy {
  AGGRESSIVE = 'aggressive',
  CONSERVATIVE = 'conservative',
  BALANCED = 'balanced',
}

/**
 * CodeBuild build states.
 */
export enum BuildStatus {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  STOPPED = 'STOPPED',
  TIMED_OUT = 'TIMED_OUT',
  FAULT = 'FAULT',
  IN_PROGRESS = 'IN_PROGRESS',
}

/**
 * Parallel task completion status.
 */
export enum ParallelTaskStatus {
  SUCCESS = 'success',
  PARTIAL = 'partial',
  FAILED = 'failed',
  TIMED_OUT = 'timed_out',
}

/**
 * Health issue severity levels.
 */
export enum HealthSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}
