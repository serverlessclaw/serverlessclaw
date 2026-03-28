/**
 * Dashboard-specific constants to improve AI signal clarity and maintainability
 */
import {
  AGENT_ERRORS,
  HTTP_STATUS as CORE_HTTP_STATUS,
  DYNAMO_KEYS as CORE_DYNAMO_KEYS,
  TRACE_TYPES as CORE_TRACE_TYPES,
  TRACE_STATUS as CORE_TRACE_STATUS,
  NODE_ICON as CORE_NODE_ICON
} from '@claw/core/lib/constants';

export const HTTP_STATUS = CORE_HTTP_STATUS;
export const DYNAMO_KEYS = CORE_DYNAMO_KEYS;
export const TRACE_TYPES = CORE_TRACE_TYPES;
export const TRACE_STATUS = CORE_TRACE_STATUS;
export const NODE_ICON = CORE_NODE_ICON;
export { AGENT_ERRORS };

/** Canonical icons from Lucide library. Moved from core to dashboard. */
export const RESOURCE_ICON = {
  APP: 'Globe',
  BOT: 'Bot',
  BRAIN: 'Brain',
  BUS: 'MessageCircle',
  DATABASE: 'Database',
  DASHBOARD: 'LayoutDashboard',
  HAMMER: 'Hammer',
  RADIO: 'Radio',
  SEND: 'Send',
  SIGNAL: 'Zap',
  STETHOSCOPE: 'Activity',
  ZAP: 'Zap',
  CODE: 'Code',
  SEARCH: 'Search',
  QA: 'FlaskConical',
  GEAR: 'Settings2',
  BELL: 'Bell',
  CALENDAR: 'Calendar',
} as const;

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
  SCHEDULING: 'Goal Scheduling',
  NODE_STATUS: 'CORE_SYNC',
  SYSTEM_ONLINE: 'LINK_ESTABLISHED',
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
  SCHEDULING: '/scheduling',
} as const;
