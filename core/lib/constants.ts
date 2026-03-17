/**
 * System-wide constants to prevent magic literals and improve AI signal clarity.
 * These constants are used across the Serverless Claw stack for configuration,
 * resource naming, and status codes.
 */

/**
 * System-wide constants for agent orchestration and resource management.
 */
export const SYSTEM = {
  USER_ID: 'SYSTEM',
  DEPLOY_STATS_KEY: 'SYSTEM#DEPLOY_STATS',
  RECOVERY_KEY: 'SYSTEM#RECOVERY',
  DEFAULT_DEPLOY_LIMIT: 5,
  MAX_DEPLOY_LIMIT: 100,
  // 15 hops allows ~4 full plan→code→QA→reopen cycles before the guard fires.
  // The old value of 50 allowed ~12 autonomous infrastructure cycles — dangerously high.
  DEFAULT_RECURSION_LIMIT: 15,
} as const;

export const PROTECTED_FILES = [
  'sst.config.ts',
  'core/tools/index.ts',
  'core/agents/superclaw.ts',
  'core/lib/agent.ts',
  'buildspec.yml',
  'core/lib/constants.ts',
  'package.json',
  'package-lock.json',
  '.env',
  'infra/',
] as const;

export const STORAGE = {
  STAGING_ZIP: 'staged_changes.zip',
  TMP_STAGING_ZIP: '/tmp/staged_changes.zip',
} as const;

export const RETENTION = {
  MESSAGES_DAYS: 30,
  TRACES_DAYS: 30,
  LESSONS_DAYS: 90,
  SESSIONS_DAYS: 30,
  ASSETS_DAYS: 30,
} as const;

export const DYNAMO_KEYS = {
  DEPLOY_LIMIT: 'deploy_limit',
  RECURSION_LIMIT: 'recursion_limit',
  GLOBAL_PAUSE: 'global_pause',
  AGENTS_CONFIG: 'agents_config',
  INFRA_CONFIG: 'infra_config',
  SYSTEM_TOPOLOGY: 'system_topology',
  RETENTION_CONFIG: 'retention_config',
  TOOL_USAGE: 'tool_usage',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const TRACE_TYPES = {
  LLM_CALL: 'llm_call',
  LLM_RESPONSE: 'llm_response',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ERROR: 'error',
} as const;

export const TRACE_STATUS = {
  STARTED: 'started',
  COMPLETED: 'completed',
} as const;

/**
 * Time conversion constants (in milliseconds)
 * These help eliminate magic number calculations throughout the codebase
 */
export const TIME = {
  SECONDS_IN_MINUTE: 60,
  SECONDS_IN_HOUR: 3600,
  SECONDS_IN_DAY: 86400,
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60000,
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: 86400000,
} as const;

/**
 * Memory and storage limits
 */
export const LIMITS = {
  TRACE_TRUNCATE_LENGTH: 5000,
  MAX_CONTEXT_LENGTH: 10000,
  DEFAULT_LOCK_TTL: 300,
  STALE_GAP_DAYS: 30,
  TWO_YEARS_DAYS: 730,
} as const;

/**
 * DynamoDB table and index names
 */
export const DYNAMO = {
  TABLE_NAME: process.env.MEMORY_TABLE || 'ServerlessClaw-Memory',
  TYPE_TIMESTAMP_INDEX: 'TypeTimestampIndex',
} as const;

/**
 * Gap status values
 */
export const GAP_STATUS = {
  OPEN: 'open',
  ADDRESSED: 'addressed',
  DISMISSED: 'dismissed',
} as const;

/**
 * Memory key prefixes for distilled memory storage
 */
export const MEMORY_KEYS = {
  STRATEGIC_REVIEW: 'LAST#STRATEGIC_REVIEW',
} as const;

/**
 * Memory tiers for retention
 */
export const MEMORY_TIER = {
  MESSAGES: 'MESSAGES',
  DISTILLED: 'DISTILLED',
  INSIGHTS: 'INSIGHTS',
  SESSIONS: 'SESSIONS',
  TRACES: 'TRACES',
} as const;
/**
 * Standardized agent error messages for consistent detection and gap reporting.
 */
export const AGENT_ERRORS = {
  PROCESS_FAILURE:
    "I encountered an internal processing error while handling your request. I've registered this failure as a strategic gap for my evolution cycle, and my engineering team will review it. Please try again or rephrase your query.",
  CONNECTION_FAILURE:
    'SYSTEM_ERROR: Connection interrupted or internal failure. Technical details logged as strategic gap.',
} as const;
