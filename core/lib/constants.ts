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
} as const;

export const PROTECTED_FILES = [
  'sst.config.ts',
  'src/tools/index.ts',
  'src/agents/superclaw.ts',
  'src/lib/agent.ts',
  'buildspec.yml',
  'infra/',
] as const;

export const STORAGE = {
  STAGING_ZIP: 'staged_changes.zip',
  TMP_STAGING_ZIP: '/tmp/staged_changes.zip',
} as const;

export const DYNAMO_KEYS = {
  DEPLOY_LIMIT: 'deploy_limit',
  AGENTS_CONFIG: 'agents_config',
  INFRA_CONFIG: 'infra_config',
  SYSTEM_TOPOLOGY: 'system_topology',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const AGENT_MODES = {
  HITL: 'hitl',
  AUTO: 'auto',
} as const;
