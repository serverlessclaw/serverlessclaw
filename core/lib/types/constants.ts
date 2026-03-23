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
 * Status values for strategic gaps.
 */
export enum GapStatus {
  OPEN = 'open',
  ADDRESSED = 'addressed',
  DISMISSED = 'dismissed',
  PLANNED = 'planned',
}

/**
 * Optimization policies for system-wide reasoning depth.
 */
export enum OptimizationPolicy {
  AGGRESSIVE = 'aggressive',
  CONSERVATIVE = 'conservative',
  BALANCED = 'balanced',
}
