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
  DEFAULT_PROVIDER: LLMProvider.OPENAI,
  DEFAULT_MODEL: OpenAIModel.GPT_5_MINI,
  DEFAULT_OPENAI_MODEL: OpenAIModel.GPT_5_4_MINI,
  DEFAULT_BEDROCK_MODEL: BedrockModel.CLAUDE_4_6,
  DEFAULT_OPENROUTER_MODEL: OpenRouterModel.GLM_5,
  DEFAULT_MINIMAX_MODEL: MiniMaxModel.M2_7,
  DEFAULT_RECURSION_LIMIT: 7,
  DEFAULT_DEPLOY_LIMIT: CONFIG_DEFAULTS?.DEPLOY_LIMIT?.code ?? 5,
  MAX_DEPLOY_LIMIT: CONFIG_DEFAULTS?.MAX_DEPLOY_LIMIT?.code ?? 100,
  RECOVERY_KEY: 'SYSTEM#RECOVERY',
  DEPLOY_STATS_KEY: 'SYSTEM#DEPLOY_STATS',
  UPTIME_KEY: 'SYSTEM#UPTIME',
  USER_ID: 'SYSTEM',
  DEFAULT_SIMPLE_TASK_THRESHOLD: 500,
  RESOURCES: {
    API: 'api',
    DASHBOARD: 'dashboard',
    ROUTER: 'router',
    BUS: 'bus',
  },
  DEFAULT_GITHUB_REPO: 'serverlessclaw/serverlessclaw',
} as const;

/**
 * DynamoDB Table Item Keys (PK/SK patterns).
 */
export const DYNAMO_KEYS = {
  AGENTS_CONFIG: 'agents_config',
  DEPLOY_LIMIT: 'deploy_limit',
  RECURSION_LIMIT: 'recursion_limit',
  MISSION_RECURSION_LIMIT: 'mission_recursion_limit',
  RETENTION_CONFIG: 'retention_config',
  TOOL_USAGE: 'tool_usage_global',
  /** Workspace-scoped tool usage: key is WS#{workspaceId}#tool_usage */
  TOOL_USAGE_PREFIX: 'tool_usage',
  ACTIVE_PROVIDER: 'active_provider',
  ACTIVE_MODEL: 'active_model',
  ACTIVE_LOCALE: 'active_locale',
  OPTIMIZATION_POLICY: 'optimization_policy',
  REASONING_PROFILES: 'reasoning_profiles',
  MAX_TOOL_ITERATIONS: 'max_tool_iterations',
  GLOBAL_PAUSE: 'global_pause',
  INFRA_CONFIG: 'infra_config',
  SYSTEM_TOPOLOGY: 'system_topology',
  AGENT_TOOL_OVERRIDES: 'agent_tool_overrides',
  TOOL_METADATA_OVERRIDES: 'tool_metadata_overrides',
  GOVERNANCE_CONFIG: 'governance_config',
  GOVERNANCE_STATE: 'governance_state',
  TRUST_SCORE_HISTORY: 'trust:score_history',
  TRUST_PENALTY_LOG: 'trust:penalty_log',
  CLARIFICATION_TIMEOUT_MS: 'clarification_timeout_ms',
  CLARIFICATION_MAX_RETRIES: 'clarification_max_retries',
  CONTEXT_SAFETY_MARGIN: 'context_safety_margin',
  CONTEXT_SUMMARY_TRIGGER_RATIO: 'context_summary_trigger_ratio',
  CONTEXT_SUMMARY_RATIO: 'context_summary_ratio',
  CONTEXT_ACTIVE_WINDOW_RATIO: 'context_active_window_ratio',
  REPUTATION_PREFIX: 'REPUTATION#',
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
  UI_THEME: 'ui_theme',
  UI_SIDEBAR_STATE: 'ui_sidebar_state',
  UI_LAYOUT: 'ui_layout',
  GLOBAL_TOKEN_BUDGET: 'global_token_budget',
  GLOBAL_COST_LIMIT: 'global_cost_limit',
  SESSION_TOKEN_BUDGET: 'session_token_budget',
  SESSION_COST_LIMIT: 'session_cost_limit',
  SIMPLE_TASK_THRESHOLD: 'simple_task_threshold',
} as const;

/**
 * Swarm orchestration constants.
 */
export const SWARM = {
  /** Maximum recursive depth for swarm fanout to prevent runaway decomposition. */
  MAX_RECURSIVE_DEPTH: 7,
  /** Default max sub-tasks per decomposition. */
  DEFAULT_MAX_SUB_TASKS: 4,
  /** Default barrier timeout for parallel tasks (5 minutes). */
  DEFAULT_BARRIER_TIMEOUT_MS: 300_000,
} as const;

/**
 * Trust Score Constants
 * Centralized trust scoring parameters for Silo 6: The Scales.
 */
export const TRUST = {
  /** Default trust score for new agents when not specified. */
  DEFAULT_SCORE: 90,
  /** Minimum allowed trust score (floor). */
  MIN_SCORE: 0,
  /** Maximum allowed trust score (ceiling). */
  MAX_SCORE: 100,
  /** Default penalty applied for failures (before severity multiplier). */
  DEFAULT_PENALTY: -5,
  /** Default trust increment for successful tasks. */
  DEFAULT_SUCCESS_BUMP: 1,
  /** Trust decay rate per day (0.5 means decay from 90 to 70 takes ~40 days). */
  DECAY_RATE: 0.5,
  /** Trust score baseline - decay won't reduce below this threshold. */
  DECAY_BASELINE: 70,
  /** Trust score threshold for autonomous mode promotion (Principle 9). */
  AUTONOMY_THRESHOLD: 95,
  /** Trust score threshold for facilitator tie-breaking. */
  FACILITATOR_THRESHOLD: 90,
} as const;

/**
 * Mapping of providers to their cheapest available model for utility/simple tasks.
 */
export const UTILITY_MODELS: Record<string, string> = {
  [LLMProvider.OPENAI]: OpenAIModel.GPT_5_4_NANO,
  [LLMProvider.BEDROCK]: 'anthropic.claude-3-haiku-20240307-v1:0',
  [LLMProvider.MINIMAX]: MiniMaxModel.M2_7_HIGHSPEED,
  [LLMProvider.OPENROUTER]: OpenRouterModel.GEMINI_3_FLASH,
};
