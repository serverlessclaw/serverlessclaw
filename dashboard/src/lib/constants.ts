/**
 * Dashboard-specific constants to improve AI signal clarity and maintainability
 */

export const AUTH = {
  COOKIE_NAME: 'claw_auth_session',
  COOKIE_VALUE: 'authenticated',
  COOKIE_MAX_AGE: 60 * 60 * 24 * 7, // 1 week
  ERROR_INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ERROR_SYSTEM_FAILURE: 'SYSTEM_FAILURE',
} as const;

export const API_ROUTES = {
  WEBHOOK: '/webhook',
  HEALTH: '/health',
  AGENTS: '/api/agents',
  CHAT: '/api/chat',
  MEMORY_PRIORITIZE: '/api/memory/prioritize',
} as const;

export const DYNAMO_KEYS = {
  DEPLOY_LIMIT: 'deploy_limit',
  AGENTS_CONFIG: 'agents_config',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const UI_STRINGS = {
  DASHBOARD_TITLE: 'ClawCenter',
  MISSING_MESSAGE: 'Missing message',
  API_CHAT_ERROR: 'API Chat Error:',
  TRACE_NOT_FOUND: 'TRACE_NOT_FOUND',
  RETURN_TO_BASE: 'RETURN_TO_BASE',
  BACK_TO_INTELLIGENCE: 'BACK_TO_INTELLIGENCE',
  NEURAL_PATH_VISUALIZER: 'Neural Path Visualizer',
  EXECUTION_TIMELINE: 'Execution Timeline',
  RAW_PAYLOAD: 'RAW_PAYLOAD',
  FINAL_OUTPUT: 'Final Output',
  INTELLIGENCE_HEADER: 'Intelligence',
  EVOLUTION_HEADER: 'Evolution',
  SYSTEM_HEADER: 'System',
  INFRA_HEADER: 'Infrastructure',
  OBSERVABILITY_HEADER: 'Observability',
  CHAT_DIRECT: 'CHAT_DIRECT',
  TRACE_INTEL: 'TRACE_INTEL',
  AGENTS: 'AGENTS',
  MEMORY_RESERVE: 'NEURAL_RESERVE',
  CAPABILITIES: 'CAPABILITIES',
  SYSTEM_PULSE: 'SYSTEM_PULSE',
  SESSION_TRAFFIC: 'SESSION_TRAFFIC',
  CONFIG: 'CONFIG',
  SECURITY_MANIFEST: 'SECURITY_MANIFEST',
  SELF_HEALING: 'SELF_HEALING',
  NODE_STATUS: 'Node Status',
  SYSTEM_ONLINE: 'SYSTEM_ONLINE',
  VERSION_PROTOTYPE: 'v1.0.0-PROTOTYPE',
  BUILD_YEAR: '2026',
} as const;

export const ROUTES = {
  HOME: '/',
  CHAT: '/',
  TRACE: '/trace',
  AGENTS: '/agents',
  MEMORY: '/memory',
  CAPABILITIES: '/capabilities',
  SYSTEM_PULSE: '/system-pulse',
  LOCKS: '/locks',
  SETTINGS: '/settings',
  SECURITY: '/security',
  RESILIENCE: '/resilience',
} as const;

export const TRACE_TYPES = {
  LLM_CALL: 'llm_call',
  LLM_RESPONSE: 'llm_response',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ERROR: 'error',
} as const;

export const TRACE_STATUS = {
  COMPLETED: 'completed',
} as const;
