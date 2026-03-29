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
  },
  {
    match: (k) => k.includes('api') || k === 'webhookapi',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.APP,
    label: 'Webhook API',
    tier: NODE_TIER.APP,
  },
  {
    match: (k) => k === 'memorytable' || k === 'memory',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: 'Memory (DynamoDB)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'tracetable' || k === 'traces',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: 'Traces (DynamoDB)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'configtable' || k === 'config',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.GEAR,
    label: 'Config (DynamoDB)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'knowledgebucket' || k === 'knowledge',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: 'Knowledge Storage (S3)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'stagingbucket' || k === 'staging',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.HAMMER,
    label: 'Staging Storage (S3)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'deployer' || k === 'codebuild',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.HAMMER,
    tier: NODE_TIER.INFRA,
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
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: 'Realtime Bridge (Lambda)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'realtimebus',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.RADIO,
    label: 'Realtime Bus (IoT Core)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'heartbeathandler' || k === 'heartbeat',
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: 'Heartbeat Handler',
    tier: NODE_TIER.COMM,
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
        'reflector',
        'qa',
        'critic',
        'optimizer',
        'agentrunner',
      ].includes(k) ||
      k.includes('agent') ||
      k.includes('worker'),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.BOT,
    tier: NODE_TIER.AGENT,
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
