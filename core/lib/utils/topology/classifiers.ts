import { NODE_TYPE, NODE_TIER, NODE_ICON, TOPOLOGY_LABELS, INFRA_NODE_ID } from './constants';

export interface ResourceClassifier {
  match: (key: string) => boolean;
  type: string;
  icon: string;
  tier: 'APP' | 'GATEWAY' | 'COMM' | 'AGENT' | 'UTILITY' | 'INFRA';
  label?: string;
  idOverride?: string;
}

export const CLASSIFIERS: ResourceClassifier[] = [
  {
    match: (k) => k === 'agentbus' || k === 'bus',
    type: NODE_TYPE.BUS,
    icon: NODE_ICON.BUS,
    label: TOPOLOGY_LABELS.AGENT_BUS,
    tier: NODE_TIER.COMM,
    idOverride: INFRA_NODE_ID.AGENT_BUS,
  },
  {
    match: (k) => k.includes('queue') || k.includes('sqs'),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.ASYNC_QUEUE,
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k.includes('api') || k === 'webhookapi',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.APP,
    label: TOPOLOGY_LABELS.WEBHOOK_API,
    tier: NODE_TIER.GATEWAY,
    idOverride: INFRA_NODE_ID.WEBHOOK_API,
  },
  {
    match: (k) =>
      ['memorytable', 'memory', 'tracetable', 'traces', 'configtable', 'config'].includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: TOPOLOGY_LABELS.CLAW_DB,
    tier: NODE_TIER.INFRA,
    idOverride: INFRA_NODE_ID.CLAWDB,
  },
  {
    match: (k) => k === 'knowledgebucket' || k === 'knowledge',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: TOPOLOGY_LABELS.KNOWLEDGE_STORAGE,
    tier: NODE_TIER.INFRA,
    idOverride: INFRA_NODE_ID.KNOWLEDGE_BUCKET,
  },
  {
    match: (k) => k === 'documentation' || k === 'docs' || k === 'documents',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: TOPOLOGY_LABELS.DOCUMENT_STORE,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k.includes('search') || k.includes('vector') || k === 'collection',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: TOPOLOGY_LABELS.OPEN_SEARCH,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'stagingbucket' || k === 'staging',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: TOPOLOGY_LABELS.STAGING_STORAGE,
    tier: NODE_TIER.INFRA,
    idOverride: INFRA_NODE_ID.STAGING_BUCKET,
  },
  {
    match: (k) => k === 'deployer' || k === 'codebuild',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.HAMMER,
    tier: NODE_TIER.UTILITY,
    idOverride: INFRA_NODE_ID.DEPLOYER,
  },
  {
    match: (k) => k === 'notifier',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.BELL,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => k === 'dashboard' || k === 'clawcenter',
    type: NODE_TYPE.DASHBOARD,
    icon: NODE_ICON.DASHBOARD,
    label: TOPOLOGY_LABELS.CLAW_CENTER,
    tier: NODE_TIER.APP,
    idOverride: INFRA_NODE_ID.DASHBOARD,
  },
  {
    match: (k) => k === 'realtimebridge' || k === 'bridge',
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.REALTIME_BRIDGE,
    tier: NODE_TIER.COMM,
    idOverride: INFRA_NODE_ID.REALTIME_BRIDGE,
  },
  {
    match: (k) => k === 'realtimebus' || k === 'realtime',
    type: NODE_TYPE.BUS,
    icon: NODE_ICON.RADIO,
    label: TOPOLOGY_LABELS.REALTIME_BUS,
    tier: NODE_TIER.GATEWAY,
    idOverride: INFRA_NODE_ID.REALTIME_BUS,
  },
  {
    match: (k) => k === 'heartbeathandler' || k === 'heartbeat',
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.HEARTBEAT_ENGINE,
    tier: NODE_TIER.GATEWAY,
    idOverride: INFRA_NODE_ID.HEARTBEAT,
  },
  {
    match: (k) => k === 'concurrencymonitor',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.STETHOSCOPE,
    label: TOPOLOGY_LABELS.CONCURRENCY_MONITOR,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'eventhandler' || k === 'events',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.ZAP,
    label: TOPOLOGY_LABELS.EVENT_HANDLER,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => k === 'deadmansswitch' || k === 'recovery',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.DEAD_MANS_SWITCH,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => k.includes('multiplexer'),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SERVER,
    label: TOPOLOGY_LABELS.MCP_MULTIPLEXER,
    tier: NODE_TIER.INFRA,
    idOverride: 'mcp-multiplexer',
  },
  {
    match: (k) => k.startsWith('mcp') && k.endsWith('server'),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.GEAR,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'mcpwarmuphandler',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.MCP_WARMUP_HANDLER,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => k === 'superclaw',
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.BRAIN,
    tier: NODE_TIER.GATEWAY,
  },
  {
    match: (k) =>
      [
        'mcpservermultiplexer',
        'multiplexer',
        'monitor',
        'buildmonitor',
        'build-monitor',
        'eventhandler',
        'events',
        'deadmansswitch',
        'recovery',
        'bridge',
        'realtimebridge',
        'dlqhandler',
        'notifier',
        'heartbeathandler',
        'concurrencymonitor',
      ].includes(k) ||
      k.includes('worker') ||
      k.includes('handler') ||
      k.includes('monitor'),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.GEAR,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) =>
      [
        'coder',
        'strategicplanner',
        'strategic-planner',
        'planner',
        'reflector',
        'cognitionreflector',
        'cognition-reflector',
        'qa',
        'critic',
        'agentrunner',
        'runner',
        'merger',
        'researcher',
      ].includes(k) ||
      (k.includes('agent') &&
        !k.includes('handler') &&
        !k.includes('worker') &&
        !k.includes('monitor') &&
        !k.includes('manager')),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.BRAIN,
    tier: NODE_TIER.AGENT,
  },
  {
    match: (k) => k === 'eventdlq' || k === 'dlq',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.DEAD_LETTER_QUEUE,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'realtimebus',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.RADIO,
    label: TOPOLOGY_LABELS.REALTIME_BUS_IOT,
    tier: NODE_TIER.GATEWAY,
  },
];

/**
 * Classifies a resource key into a topology node type.
 * @param key - The resource key to classify
 * @returns The matching classifier or undefined
 */
export function classifyResource(key: string): ResourceClassifier | undefined {
  const lowerKey = key.toLowerCase();
  return CLASSIFIERS.find((c) => c.match(lowerKey));
}
