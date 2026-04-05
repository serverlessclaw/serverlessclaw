/**
 * Centralized Configuration Defaults
 *
 * This module provides a single source of truth for all configurable system defaults.
 * It ensures consistency between code, documentation, and runtime configuration.
 *
 * All values that can be overridden via ConfigTable are documented here with their
 * code default, documentation reference, and whether they're hot-swappable.
 */

export const CONFIG_DEFAULTS = {
  /** Maximum recursion depth for multi-agent delegation. Default: 15 */
  RECURSION_LIMIT: {
    code: 15,
    hotSwappable: true,
    configKey: 'recursion_limit',
    description: 'Maximum depth for agent-to-agent delegation to prevent infinite loops.',
  },

  /** Default daily deployment limit. Default: 5 */
  DEPLOY_LIMIT: {
    code: 5,
    hotSwappable: true,
    configKey: 'deploy_limit',
    description: 'Maximum autonomous deployments per UTC day.',
  },

  /** Hard cap on daily deployments regardless of config. Default: 100 */
  MAX_DEPLOY_LIMIT: {
    code: 100,
    hotSwappable: false,
    configKey: null,
    description: 'Absolute maximum deployments per day to prevent runaway costs.',
  },

  /** Circuit breaker threshold for failures in sliding window. Default: 5 */
  CIRCUIT_BREAKER_THRESHOLD: {
    code: 5,
    hotSwappable: true,
    configKey: 'circuit_breaker_threshold',
    description: 'Build/health failures within the sliding window before opening the circuit.',
  },

  /** Sliding window duration for circuit breaker failure tracking. Default: 3600000 (1 hour) */
  CIRCUIT_BREAKER_WINDOW_MS: {
    code: 3600000,
    hotSwappable: true,
    configKey: 'circuit_breaker_window_ms',
    description: 'Sliding window duration for circuit breaker failure tracking.',
  },

  /** Cooldown before transitioning from open to half-open. Default: 600000 (10 minutes) */
  CIRCUIT_BREAKER_COOLDOWN_MS: {
    code: 600000,
    hotSwappable: true,
    configKey: 'circuit_breaker_cooldown_ms',
    description: 'Cooldown duration before transitioning from open to half-open state.',
  },

  /** Max probe deployments allowed in half-open state. Default: 1 */
  CIRCUIT_BREAKER_HALF_OPEN_MAX: {
    code: 1,
    hotSwappable: true,
    configKey: 'circuit_breaker_half_open_max',
    description: 'Max probe deployments allowed in half-open state before reopening.',
  },

  /** Maximum recovery attempts before escalation. Default: 4 */
  MAX_RECOVERY_ATTEMPTS: {
    code: 4,
    hotSwappable: false,
    configKey: null,
    description: 'Dead Mans Switch recovery attempts before alerting admin.',
  },

  /** Lock TTL for recovery operations (seconds). Default: 1200 (20 min) */
  RECOVERY_LOCK_TTL_SECONDS: {
    code: 1200,
    hotSwappable: false,
    configKey: null,
    description: 'Lock TTL slightly longer than Dead Mans Switch schedule.',
  },

  /** Default tool iteration limit. Default: 50 */
  MAX_TOOL_ITERATIONS: {
    code: 50,
    hotSwappable: true,
    configKey: 'max_tool_iterations',
    description: 'Maximum tool calls per agent process before pausing.',
  },

  /** TTL for memory traces (days). Default: 30 */
  TRACE_RETENTION_DAYS: {
    code: 30,
    hotSwappable: false,
    configKey: null,
    description: 'Days to retain agent execution traces.',
  },

  /** TTL for messages (days). Default: 7 */
  MESSAGE_RETENTION_DAYS: {
    code: 7,
    hotSwappable: false,
    configKey: null,
    description: 'Days to retain conversation messages.',
  },

  /** Days before a stale gap is auto-archived. Default: 30 */
  STALE_GAP_DAYS: {
    code: 30,
    hotSwappable: true,
    configKey: 'stale_gap_days',
    description: 'Days before an open gap is considered stale.',
  },
  /** Strategic review frequency (hours). Default: 48 */
  STRATEGIC_REVIEW_FREQUENCY_HOURS: {
    code: 48,
    hotSwappable: true,
    configKey: 'strategic_review_frequency',
    description: 'Hours between proactive strategic planner reviews.',
  },

  /** Minimum number of gaps before triggering strategic review. Default: 20 */
  MIN_GAPS_FOR_REVIEW: {
    code: 20,
    hotSwappable: true,
    configKey: 'min_gaps_for_review',
    description: 'Minimum open gaps required to trigger a proactive strategic review.',
  },

  /** Cooldown period after planner run (ms). Default: 21600000 (6 hours) */
  PLANNER_COOLDOWN_MS: {
    code: 21600000,
    hotSwappable: false,
    configKey: null,
    description: 'Cooldown between planner evolution cycles.',
  },

  /** Exponential backoff base time (ms). Default: 900000 (15 min) */
  BACKOFF_BASE_MS: {
    code: 900000,
    hotSwappable: true,
    configKey: 'backoff_base_ms',
    description: 'Base time for exponential backoff between gap retries.',
  },

  /** Agent timeout buffer (ms). Default: 30000 (30 sec) */
  TIMEOUT_BUFFER_MS: {
    code: 30000,
    hotSwappable: false,
    configKey: null,
    description: 'Time reserved before Lambda timeout for graceful shutdown.',
  },

  /** EventBridge emit retry count. Default: 3 */
  EB_MAX_RETRIES: {
    code: 3,
    hotSwappable: false,
    configKey: null,
    description: 'Maximum retries for EventBridge emit failures.',
  },

  /** EventBridge initial backoff (ms). Default: 100 */
  EB_INITIAL_BACKOFF_MS: {
    code: 100,
    hotSwappable: false,
    configKey: null,
    description: 'Initial backoff time for EventBridge retries.',
  },

  /** Default MCP hub connection timeout (ms). Default: 5000 */
  MCP_HUB_TIMEOUT_MS: {
    code: 5000,
    hotSwappable: true,
    configKey: 'mcp_hub_timeout_ms',
    description: 'Timeout for MCP hub connections before falling back to local.',
  },

  /** Lambda memory for backbone agents (MB). Default: 2048 */
  LARGE_LAMBDA_MEMORY_MB: {
    code: 2048,
    hotSwappable: false,
    configKey: null,
    description: 'Memory allocation for backbone agents.',
  },

  /** Lambda timeout for backbone agents (seconds). Default: 900 (15 min) */
  LARGE_LAMBDA_TIMEOUT_SECONDS: {
    code: 900,
    hotSwappable: false,
    configKey: null,
    description: 'Timeout for backbone agent Lambdas.',
  },

  /** Auto-prune low-utilization tools. Default: false */
  AUTO_PRUNE_ENABLED: {
    code: false,
    hotSwappable: true,
    configKey: 'auto_prune_enabled',
    description: 'Whether to automatically prune unused tools without HITL.',
  },

  /** Days before tool considered low-utilization. Default: 30 */
  TOOL_PRUNE_THRESHOLD_DAYS: {
    code: 30,
    hotSwappable: true,
    configKey: 'tool_prune_threshold_days',
    description: 'Days without tool usage before auto-prune eligible.',
  },

  /** Timeout for clarification requests before escalation. Default: 300000 (5 min) */
  CLARIFICATION_TIMEOUT_MS: {
    code: 300000,
    hotSwappable: true,
    configKey: 'clarification_timeout_ms',
    description: 'Timeout for clarification requests before escalation.',
  },

  /** Max clarification retries before marking task failed. Default: 1 */
  CLARIFICATION_MAX_RETRIES: {
    code: 1,
    hotSwappable: true,
    configKey: 'clarification_max_retries',
    description: 'Max clarification retries before marking task failed.',
  },

  /** Barrier timeout for parallel tasks. Default: 300000 (5 min) */
  PARALLEL_BARRIER_TIMEOUT_MS: {
    code: 300000,
    hotSwappable: true,
    configKey: 'parallel_barrier_timeout_ms',
    description: 'Barrier timeout for parallel task dispatch.',
  },

  /** Partial success threshold for parallel tasks. Default: 0.5 (50%) */
  PARALLEL_PARTIAL_SUCCESS_THRESHOLD: {
    code: 0.5,
    hotSwappable: true,
    configKey: 'parallel_partial_success_threshold',
    description:
      'Fraction of parallel tasks that must succeed for overall status to be "partial" instead of "failed".',
  },

  /** Fraction of context reserved for response and safety. Default: 0.2 */
  CONTEXT_SAFETY_MARGIN: {
    code: 0.2,
    hotSwappable: true,
    configKey: 'context_safety_margin',
    description: 'Fraction of max context reserved for LLM response and safety buffer.',
  },

  /** Ratio of history usage that triggers summarization/compaction. Default: 0.8 */
  CONTEXT_SUMMARY_TRIGGER_RATIO: {
    code: 0.8,
    hotSwappable: true,
    configKey: 'context_summary_trigger_ratio',
    description: 'Ratio of context usage that triggers history summarization.',
  },

  /** Budget fraction for compressed history (key facts). Default: 0.3 */
  CONTEXT_SUMMARY_RATIO: {
    code: 0.3,
    hotSwappable: true,
    configKey: 'context_summary_ratio',
    description: 'Fraction of available context budget for compressed history (key facts).',
  },

  /** Budget fraction for active message window. Default: 0.7 */
  CONTEXT_ACTIVE_WINDOW_RATIO: {
    code: 0.7,
    hotSwappable: true,
    configKey: 'context_active_window_ratio',
    description: 'Fraction of available context budget for active message window.',
  },

  /** Global feature flags enable/disable. Default: true */
  FEATURE_FLAGS_ENABLED: {
    code: true,
    hotSwappable: true,
    configKey: 'feature_flags_enabled',
    description: 'Global kill switch for feature flag evaluation system.',
  },

  /** Error rate threshold for agent alerting. Default: 0.3 (30%) */
  ALERT_ERROR_RATE_THRESHOLD: {
    code: 0.3,
    hotSwappable: true,
    configKey: 'alert_error_rate_threshold',
    description: 'Error rate threshold for agent alerting.',
  },

  /** DLQ event count threshold for alerting. Default: 10 */
  ALERT_DLQ_THRESHOLD: {
    code: 10,
    hotSwappable: true,
    configKey: 'alert_dlq_threshold',
    description: 'DLQ event count threshold for alerting.',
  },

  /** Token anomaly multiplier for alerting. Default: 3.0 */
  ALERT_TOKEN_ANOMALY_MULTIPLIER: {
    code: 3.0,
    hotSwappable: true,
    configKey: 'alert_token_anomaly_multiplier',
    description: 'Alert if tokens exceed this multiplier above rolling average.',
  },

  /** Whether multi-level escalation is enabled. Default: true */
  ESCALATION_ENABLED: {
    code: true,
    hotSwappable: true,
    configKey: 'escalation_enabled',
    description: 'Whether multi-level escalation is enabled for clarification requests.',
  },

  /** Whether protocol fallback (JSON -> Text) is enabled. Default: true */
  PROTOCOL_FALLBACK_ENABLED: {
    code: true,
    hotSwappable: true,
    configKey: 'protocol_fallback_enabled',
    description: 'Automatic fallback to Text mode when JSON communication fails.',
  },
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

export function getConfigValue<K extends ConfigKey>(
  key: K,
  runtimeValue?: unknown
): (typeof CONFIG_DEFAULTS)[K]['code'] {
  return (runtimeValue ?? CONFIG_DEFAULTS[key].code) as (typeof CONFIG_DEFAULTS)[K]['code'];
}

export function getHotSwappableKeys(): Array<{ key: ConfigKey; configKey: string }> {
  return Object.entries(CONFIG_DEFAULTS)
    .filter(([, def]) => def.hotSwappable && def.configKey)
    .map(([key, def]) => ({
      key: key as ConfigKey,
      configKey: def.configKey!,
    }));
}
