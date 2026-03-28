export const INFRA_NODE_ID = {
  API: 'api',
  BUS: 'bus',
  AGENT_BUS: 'agentbus',
  WEBHOOK_API: 'webhookapi',
  CODEBUILD: 'codebuild',
  CONFIG: 'config',
  CONFIG_TABLE: 'configtable',
  MEMORY: 'memory',
  MEMORY_TABLE: 'memorytable',
  STORAGE: 'storage',
  STAGING_BUCKET: 'stagingbucket',
  TRACES: 'traces',
  TRACE_TABLE: 'tracetable',
  KNOWLEDGE: 'knowledge',
  KNOWLEDGE_BUCKET: 'knowledgebucket',
  NOTIFIER: 'notifier',
  BRIDGE: 'bridge',
  REALTIME_BRIDGE: 'realtimebridge',
  REALTIME_BUS: 'realtimebus',
  TELEGRAM: 'telegram',
  DASHBOARD: 'dashboard',
  SCHEDULER: 'scheduler',
  HEARTBEAT: 'heartbeat',
  DEPLOYER: 'deployer',
} as const;

/** Canonical icons from Lucide library. */
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

/** Node type discriminators for the topology graph renderer. */
export const NODE_TYPE = {
  INFRA: 'infra' as const,
  AGENT: 'agent' as const,
  DASHBOARD: 'dashboard' as const,
  BUS: 'bus' as const,
};

/**
 * Vertical placement tiers for nodes.
 * 1: User-facing / Entry points
 * 2: Communication / Logic Hub
 * 3: Specialized Agents
 * 4: Infrastructure / Persistence
 */
export const NODE_TIER = {
  APP: 'APP' as const,
  COMM: 'COMM' as const,
  AGENT: 'AGENT' as const,
  INFRA: 'INFRA' as const,
};

/** Standard edge label vocabulary for topology links. */
export const EDGE_LABEL = {
  INBOUND: 'INBOUND',
  SIGNAL: 'SIGNAL',
  MANAGE: 'MANAGE',
  DEPLOY: 'DEPLOY',
  EVENT: 'EVENT',
  REALTIME: 'REALTIME',
  QUERY: 'QUERY',
  WEBHOOK: 'WEBHOOK',
  READ_FILES: 'READ_FILES',
  MANAGE_FILES: 'MANAGE_FILES',
  ARCHIVE: 'ARCHIVE',
  OUTBOUND: 'OUTBOUND',
  SYNC: 'SYNC',
  ORCHESTRATE: 'ORCHESTRATE',
  USE: 'USE',
  SCHEDULE: 'SCHEDULE',
  HEARTBEAT: 'HEARTBEAT',
} as const;
