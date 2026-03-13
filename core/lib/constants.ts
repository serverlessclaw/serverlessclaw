/**
 * System-wide constants to prevent magic literals and improve AI signal clarity.
 * These constants are used across the Serverless Claw stack for configuration,
 * resource naming, and status codes.
 */

export const SYSTEM = {
  USER_ID: 'SYSTEM',
  DEPLOY_STATS_KEY: 'SYSTEM#DEPLOY_STATS',
  RECOVERY_KEY: 'SYSTEM#RECOVERY',
  DEFAULT_DEPLOY_LIMIT: 5,
  MAX_DEPLOY_LIMIT: 100,
  DEFAULT_RECURSION_LIMIT: 50,
} as const;

export const PROTECTED_FILES = [
  'sst.config.ts',
  'core/tools/index.ts',
  'core/agents/superclaw.ts',
  'core/lib/agent.ts',
  'buildspec.yml',
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
  AGENTS_CONFIG: 'agents_config',
  INFRA_CONFIG: 'infra_config',
  SYSTEM_TOPOLOGY: 'system_topology',
  RETENTION_CONFIG: 'retention_config',
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
