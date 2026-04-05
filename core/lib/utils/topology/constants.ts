export const INFRA_NODE_ID = {
  API: 'api',
  BUS: 'bus',
  AGENT_BUS: 'agentbus',
  WEBHOOK_API: 'webhookapi',
  CODEBUILD: 'codebuild',
  CONFIG: 'config',
  CONFIG_TABLE: 'clawdb',
  MEMORY: 'memory',
  MEMORY_TABLE: 'clawdb',
  STORAGE: 'storage',
  STAGING_BUCKET: 'stagingbucket',
  TRACES: 'traces',
  TRACE_TABLE: 'clawdb',
  CLAWDB: 'clawdb',
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
  MCP_AST: 'mcpastserver',
  MCP_GIT: 'mcpgitserver',
  MCP_FILESYSTEM: 'mcpfilesystemserver',
  MCP_GOOGLE_SEARCH: 'mcpgooglesearchserver',
  MCP_PUPPETEER: 'mcppuppeteerserver',
  MCP_FETCH: 'mcpfetchserver',
  MCP_AWS: 'mcpawsserver',
  MCP_AWS_S3: 'mcpawss3server',
  SQS: 'sqs',
  DOCUMENTS: 'documents',
  OPEN_SEARCH: 'opensearch',
} as const;

/** Canonical icon keys for the topology graph. Mapped to UI icons in the dashboard. */
export const NODE_ICON = {
  APP: 'APP',
  BOT: 'BOT',
  BRAIN: 'BRAIN',
  BUS: 'BUS',
  DATABASE: 'DATABASE',
  DASHBOARD: 'DASHBOARD',
  HAMMER: 'HAMMER',
  RADIO: 'RADIO',
  SEND: 'SEND',
  SERVER: 'SERVER',
  SIGNAL: 'SIGNAL',
  STETHOSCOPE: 'STETHOSCOPE',
  ZAP: 'ZAP',
  CODE: 'CODE',
  SEARCH: 'SEARCH',
  QA: 'QA',
  GEAR: 'GEAR',
  BELL: 'BELL',
  CALENDAR: 'CALENDAR',
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
