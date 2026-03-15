/**
 * Dashboard-specific constants to improve AI signal clarity and maintainability
 */
export { AGENT_ERRORS } from '@claw/core/lib/constants';

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
  MEMORY_STATUS: '/api/memory/status',
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
  TRACE_NOT_FOUND: 'Trace not found',
  RETURN_TO_BASE: 'Return to Base',
  BACK_TO_INTELLIGENCE: 'Back to Intelligence',
  NEURAL_PATH_VISUALIZER: 'Trace Visualizer',
  EXECUTION_TIMELINE: 'Execution Timeline',
  RAW_PAYLOAD: 'Raw Payload',
  FINAL_OUTPUT: 'Final Output',
  INTELLIGENCE_HEADER: 'Intelligence',
  EVOLUTION_HEADER: 'Evolution',
  INFRA_HEADER: 'Infrastructure',
  CHAT_DIRECT: 'Direct Chat',
  TRACE_INTEL: 'Traces',
  EVOLUTION_PIPELINE: 'Pipeline',
  AGENTS: 'Agents',
  MEMORY_RESERVE: 'Memory',
  CAPABILITIES: 'Tools & Skills',
  SYSTEM_PULSE: 'System Pulse',
  SESSION_TRAFFIC: 'Session Traffic',
  CONFIG: 'Configuration',
  SECURITY_MANIFEST: 'Security Manifest',
  SELF_HEALING: 'Self Healing',
  NODE_STATUS: 'Agent Status',
  SYSTEM_ONLINE: 'System Online',
  VERSION_PROTOTYPE: 'v1.0.0-Prototype',
  BUILD_YEAR: '2026',
} as const;

export const ROUTES = {
  HOME: '/',
  CHAT: '/',
  TRACE: '/trace',
  AGENTS: '/agents',
  MEMORY: '/memory',
  PIPELINE: '/pipeline',
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
