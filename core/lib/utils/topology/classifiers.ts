import { NODE_TYPE, NODE_TIER, NODE_ICON } from './constants';

export interface ResourceClassifier {
  match: (key: string) => boolean;
  type: string;
  icon: string;
  tier: 'APP' | 'COMM' | 'AGENT' | 'INFRA';
  label?: string;
  idOverride?: string;
}

export const CLASSIFIERS: ResourceClassifier[] = [
  {
    match: (k) => k === 'agentbus' || k === 'bus',
    type: NODE_TYPE.BUS,
    icon: NODE_ICON.BUS,
    label: 'AgentBus (EventBridge)',
    tier: NODE_TIER.COMM,
    idOverride: 'agentbus',
  },
  {
    match: (k) => k.includes('queue') || k.includes('sqs'),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: 'Async Queue (SQS)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k.includes('api') || k === 'webhookapi',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.APP,
    label: 'Webhook API',
    tier: NODE_TIER.COMM,
    idOverride: 'webhookapi',
  },
  {
    match: (k) =>
      ['memorytable', 'memory', 'tracetable', 'traces', 'configtable', 'config'].includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: 'ClawDB (Single Table)',
    tier: NODE_TIER.INFRA,
    idOverride: 'clawdb',
  },
  {
    match: (k) => k === 'knowledgebucket' || k === 'knowledge',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: 'Knowledge Storage (S3)',
    tier: NODE_TIER.INFRA,
    idOverride: 'knowledgebucket',
  },
  {
    match: (k) => k === 'documentation' || k === 'docs' || k === 'documents',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: 'Document Store (S3)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k.includes('search') || k.includes('vector') || k === 'collection',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: 'OpenSearch Vector DB',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'stagingbucket' || k === 'staging',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: 'Staging Storage (S3)',
    tier: NODE_TIER.INFRA,
    idOverride: 'stagingbucket',
  },
  {
    match: (k) => k === 'deployer' || k === 'codebuild',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.HAMMER,
    tier: NODE_TIER.INFRA,
    idOverride: 'deployer',
  },
  {
    match: (k) => k === 'notifier',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.BELL,
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'dashboard' || k === 'clawcenter',
    type: NODE_TYPE.DASHBOARD,
    icon: NODE_ICON.DASHBOARD,
    label: 'ClawCenter (Next.js)',
    tier: NODE_TIER.APP,
    idOverride: 'dashboard',
  },
  {
    match: (k) => k === 'realtimebridge' || k === 'bridge',
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.SIGNAL,
    label: 'Realtime Bridge (Lambda)',
    tier: NODE_TIER.COMM,
    idOverride: 'realtimebridge',
  },
  {
    match: (k) => k === 'realtimebus' || k === 'realtime',
    type: NODE_TYPE.BUS,
    icon: NODE_ICON.RADIO,
    label: 'Realtime Bus (IoT Core)',
    tier: NODE_TIER.COMM,
    idOverride: 'realtimebus',
  },
  {
    match: (k) => k === 'heartbeathandler' || k === 'heartbeat',
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.SIGNAL,
    label: 'Heartbeat Engine',
    tier: NODE_TIER.COMM,
    idOverride: 'heartbeat',
  },
  {
    match: (k) => k === 'concurrencymonitor',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.STETHOSCOPE,
    label: 'Concurrency Monitor',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'eventhandler' || k === 'events',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.ZAP,
    label: 'Event Handler',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'deadmansswitch' || k === 'recovery',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: "Dead Man's Switch",
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'mcpservermultiplexer' || k === 'multiplexer',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SERVER,
    label: 'MCP Multiplexer (Lambda)',
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
    label: 'MCP Warmup Handler',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) =>
      [
        'superclaw',
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
      (k.includes('agent') && !k.includes('manager')),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.BRAIN,
    tier: NODE_TIER.AGENT,
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
    tier: NODE_TIER.AGENT,
  },
  {
    match: (k) => k === 'eventdlq' || k === 'dlq',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: 'Dead Letter Queue',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'realtimebus',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.RADIO,
    label: 'Realtime Bus (IoT)',
    tier: NODE_TIER.COMM,
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
