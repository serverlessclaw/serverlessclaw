/**
 * System-wide constants to prevent magic literals and improve AI signal clarity.
 * These constants are used across the Serverless Claw stack for configuration,
 * resource naming, and status codes.
 *
 * NOTE: For configurable defaults (recursion_limit, deploy_limit, etc.),
 * see config-defaults.ts for centralized, hot-swappable configuration.
 */

import { CONFIG_DEFAULTS } from './config-defaults';
import { LLMProvider, OpenAIModel, BedrockModel, OpenRouterModel, MiniMaxModel } from './types/llm';
import { TraceType, TraceStatus, GapStatus, OptimizationPolicy } from './types/constants';

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
} as const;

/**
 * Configuration Keys for the global ConfigTable.
 */
export const CONFIG_KEYS = {
  ACTIVE_PROVIDER: 'active_provider',
  ACTIVE_MODEL: 'active_model',
  OPTIMIZATION_POLICY: 'optimization_policy',
  REASONING_PROFILES: 'reasoning_profiles',
  MAX_TOOL_ITERATIONS: 'max_tool_iterations',
  RECURSION_LIMIT: 'recursion_limit',
  SELECTIVE_DISCOVERY_MODE: 'selective_discovery_mode',
} as const;

/**
 * Memory Partition/Sort Key prefixes.
 */
export const MEMORY_KEYS = {
  CONVERSATION_PREFIX: 'CONV#',
  FACT_PREFIX: 'FACT#',
  LESSON_PREFIX: 'LESSON#',
  SUMMARY_PREFIX: 'SUMMARY#',
  METADATA_PREFIX: 'META#',
  RECOVERY: 'SYSTEM#RECOVERY',
  STRATEGIC_REVIEW: 'SYSTEM#STRATEGIC_REVIEW',
} as const;

/**
 * HTTP Status Codes.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Trace types for ClawTracer.
 */
export const TRACE_TYPES = {
  LLM_CALL: TraceType.LLM_CALL,
  LLM_RESPONSE: TraceType.LLM_RESPONSE,
  TOOL_CALL: TraceType.TOOL_CALL,
  TOOL_RESPONSE: TraceType.TOOL_RESPONSE,
  TOOL_RESULT: TraceType.TOOL_RESPONSE,
  REFLECT: TraceType.REFLECT,
  EMIT: TraceType.EMIT,
  BRIDGE: TraceType.BRIDGE,
  ERROR: TraceType.ERROR,
} as const;

/**
 * Status values for Traces.
 */
export const TRACE_STATUS = {
  STARTED: TraceStatus.STARTED,
  COMPLETED: TraceStatus.COMPLETED,
  FAILED: TraceStatus.FAILED,
  PAUSED: TraceStatus.PAUSED,
} as const;

/**
 * Gap status values.
 */
export const GAP_STATUS = {
  OPEN: GapStatus.OPEN,
  ADDRESSED: GapStatus.ADDRESSED,
  DISMISSED: GapStatus.DISMISSED,
  PLANNED: GapStatus.PLANNED,
} as const;

/**
 * Retention policies (days).
 */
export const RETENTION = {
  MESSAGES_DAYS: CONFIG_DEFAULTS.MESSAGE_RETENTION_DAYS.code,
  TRACES_DAYS: CONFIG_DEFAULTS.TRACE_RETENTION_DAYS.code,
  FACTS_DAYS: 365,
  LESSONS_DAYS: 90,
} as const;

/**
 * Resource Limits.
 */
export const LIMITS = {
  MAX_CONTEXT_LENGTH: 32768,
  MAX_MESSAGES: 100,
  STALE_GAP_DAYS: CONFIG_DEFAULTS.STALE_GAP_DAYS.code,
  TRACE_TRUNCATE_LENGTH: 2000,
  DEFAULT_LOCK_TTL: CONFIG_DEFAULTS.RECOVERY_LOCK_TTL_SECONDS.code / 3,
  TWO_YEARS_DAYS: 730,
} as const;

/**
 * Optimization Policies.
 */
export const OPTIMIZATION_POLICIES = {
  AGGRESSIVE: OptimizationPolicy.AGGRESSIVE,
  CONSERVATIVE: OptimizationPolicy.CONSERVATIVE,
  BALANCED: OptimizationPolicy.BALANCED,
} as const;

/**
 * Time constants.
 */
export const TIME = {
  MS_PER_SECOND: 1000,
  SECONDS_IN_MINUTE: 60,
  MS_PER_MINUTE: 60000,
  SECONDS_IN_HOUR: 3600,
  SECONDS_IN_DAY: 86400,
} as const;

/**
 * Registry tool definitions.
 */
export const TOOLS = {
  dispatchTask: 'dispatchTask',
  listAgents: 'listAgents',
  checkConfig: 'checkConfig',
  registerMCPServer: 'registerMCPServer',
  inspectTrace: 'inspectTrace',
  runTests: 'runTests',
  runShellCommand: 'runShellCommand',
  stageChanges: 'stageChanges',
  triggerDeployment: 'triggerDeployment',
  validateCode: 'validateCode',
  triggerRollback: 'triggerRollback',
  queryStats: 'queryStats',
  discoverSkills: 'discoverSkills',
  installSkill: 'installSkill',
  saveMemory: 'saveMemory',
  seekClarification: 'seekClarification',
  provideClarification: 'provideClarification',
  recallKnowledge: 'recallKnowledge',
  sendMessage: 'sendMessage',
  manageGap: 'manageGap',
  reportGap: 'reportGap',
  manageAgentTools: 'manageAgentTools',
  checkHealth: 'checkHealth',
  inspectTopology: 'inspectTopology',
  setSystemConfig: 'setSystemConfig',
  listSystemConfigs: 'listSystemConfigs',
  getSystemConfigMetadata: 'getSystemConfigMetadata',
  fileUpload: 'fileUpload',
  fileDelete: 'fileDelete',
  listUploadedFiles: 'listUploadedFiles',
} as const;

/**
 * OpenAI-specific configuration and role mapping.
 */
export const OPENAI = {
  ROLES: {
    USER: 'user',
    ASSISTANT: 'assistant',
    DEVELOPER: 'developer',
  },
  ITEM_TYPES: {
    MESSAGE: 'message',
    FUNCTION_CALL: 'function_call',
    FUNCTION_CALL_OUTPUT: 'function_call_output',
  },
  CONTENT_TYPES: {
    INPUT_TEXT: 'input_text',
    INPUT_FILE: 'input_file',
    IMAGE_URL: 'image_url',
  },
  DEFAULT_FILE_NAME: 'document.pdf',
  DEFAULT_MIME_TYPE: 'application/octet-stream',
  FUNCTION_TYPE: 'function',
  MCP_TYPE: 'mcp',
} as const;

/**
 * Security-protected files that should not be modified by agents.
 */
export const PROTECTED_FILES = [
  '.git',
  '.env',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'node_modules',
];

/**
 * Storage configuration and limits.
 */
export const STORAGE = {
  MAX_FILE_SIZE_MB: 10,
  ALLOWED_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.yml', '.yaml'],
  TMP_STAGING_ZIP: '/tmp/staging.zip',
  STAGING_ZIP: 'staging.zip',
} as const;

/**
 * Common Error Messages.
 */
export const AGENT_ERRORS = {
  PROCESS_FAILURE:
    "I encountered an internal error during my cognitive processing cycle and was unable to fulfill your request. This has been logged as a strategic gap for my system's next evolution cycle, and my engineering team will review it. Please try again or rephrase your query.",
  CONNECTION_FAILURE:
    'SYSTEM_ERROR: Connection interrupted or internal failure. Technical details logged as strategic gap.',
} as const;
