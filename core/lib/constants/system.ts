import { CONFIG_DEFAULTS } from '../config/config-defaults';
import {
  LLMProvider,
  OpenAIModel,
  BedrockModel,
  OpenRouterModel,
  MiniMaxModel,
} from '../types/llm';

/**
 * System-wide defaults and operational limits.
 */
export const SYSTEM = {
  DEFAULT_PROVIDER: LLMProvider.MINIMAX,
  DEFAULT_MODEL: MiniMaxModel.M2_7,
  DEFAULT_OPENAI_MODEL: OpenAIModel.GPT_5_4_MINI,
  DEFAULT_BEDROCK_MODEL: BedrockModel.CLAUDE_4_6,
  DEFAULT_OPENROUTER_MODEL: OpenRouterModel.GLM_5,
  DEFAULT_MINIMAX_MODEL: MiniMaxModel.M2_7,
  DEFAULT_RECURSION_LIMIT: CONFIG_DEFAULTS.RECURSION_LIMIT.code,
  DEFAULT_DEPLOY_LIMIT: CONFIG_DEFAULTS.DEPLOY_LIMIT.code,
  MAX_DEPLOY_LIMIT: CONFIG_DEFAULTS.MAX_DEPLOY_LIMIT.code,
  RECOVERY_KEY: 'SYSTEM#RECOVERY',
  DEPLOY_STATS_KEY: 'SYSTEM#DEPLOY_STATS',
  UPTIME_KEY: 'SYSTEM#UPTIME',
  USER_ID: 'SYSTEM',
  RESOURCES: {
    API: 'api',
    DASHBOARD: 'dashboard',
    ROUTER: 'router',
    BUS: 'bus',
  },
} as const;

/**
 * DynamoDB Table Item Keys (PK/SK patterns).
 */
export const DYNAMO_KEYS = {
  AGENTS_CONFIG: 'agents_config',
  DEPLOY_LIMIT: 'deploy_limit',
  RECURSION_LIMIT: 'recursion_limit',
  RETENTION_CONFIG: 'retention_config',
  TOOL_USAGE: 'tool_usage_global',
  ACTIVE_PROVIDER: 'active_provider',
  ACTIVE_MODEL: 'active_model',
  ACTIVE_LOCALE: 'active_locale',
  OPTIMIZATION_POLICY: 'optimization_policy',
  REASONING_PROFILES: 'reasoning_profiles',
  MAX_TOOL_ITERATIONS: 'max_tool_iterations',
  GLOBAL_PAUSE: 'global_pause',
  INFRA_CONFIG: 'infra_config',
  SYSTEM_TOPOLOGY: 'system_topology',
  CLARIFICATION_TIMEOUT_MS: 'clarification_timeout_ms',
  CLARIFICATION_MAX_RETRIES: 'clarification_max_retries',
  CONTEXT_SAFETY_MARGIN: 'context_safety_margin',
  CONTEXT_SUMMARY_TRIGGER_RATIO: 'context_summary_trigger_ratio',
  CONTEXT_SUMMARY_RATIO: 'context_summary_ratio',
  CONTEXT_ACTIVE_WINDOW_RATIO: 'context_active_window_ratio',
  FIELDS: {
    USER_ID: 'userId',
    TIMESTAMP: 'timestamp',
    TYPE: 'type',
    TRACE_ID: 'traceId',
    NODE_ID: 'nodeId',
    KEY: 'key',
    STRING: 'string',
    NUMBER: 'number',
  },
} as const;

/**
 * Configuration Keys for the global ConfigTable.
 */
export const CONFIG_KEYS = {
  ACTIVE_PROVIDER: 'active_provider',
  ACTIVE_MODEL: 'active_model',
  ACTIVE_LOCALE: 'active_locale',
  OPTIMIZATION_POLICY: 'optimization_policy',
  REASONING_PROFILES: 'reasoning_profiles',
  MAX_TOOL_ITERATIONS: 'max_tool_iterations',
  RECURSION_LIMIT: 'recursion_limit',
  SELECTIVE_DISCOVERY_MODE: 'selective_discovery_mode',
} as const;

/**
 * Swarm orchestration constants.
 */
export const SWARM = {
  /** Maximum recursive depth for swarm fanout to prevent runaway decomposition. */
  MAX_RECURSIVE_DEPTH: 5,
  /** Default max sub-tasks per decomposition. */
  DEFAULT_MAX_SUB_TASKS: 4,
  /** Default barrier timeout for parallel tasks (5 minutes). */
  DEFAULT_BARRIER_TIMEOUT_MS: 300_000,
} as const;
