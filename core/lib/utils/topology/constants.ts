/** Canonical identifiers for well-known infrastructure and platform nodes. */
export const INFRA_NODE_ID = {
  API: 'api',
  BUS: 'bus',
  CODEBUILD: 'codebuild',
  CONFIG: 'config',
  MEMORY: 'memory',
  STORAGE: 'storage',
  TRACES: 'traces',
  KNOWLEDGE: 'knowledge',
  NOTIFIER: 'notifier',
  BRIDGE: 'bridge',
  TELEGRAM: 'telegram',
  DASHBOARD: 'dashboard',
} as const;

/** Node type discriminators for the topology graph renderer. */
export const NODE_TYPE = {
  INFRA: 'infra' as const,
  AGENT: 'agent' as const,
  DASHBOARD: 'dashboard' as const,
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
} as const;
