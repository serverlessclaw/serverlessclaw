import { NODE_TYPE, NODE_TIER, RESOURCE_ICON } from './constants';

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
    icon: RESOURCE_ICON.BUS,
    label: 'AgentBus (EventBridge)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k.includes('api') || k === 'webhookapi',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.APP,
    label: 'Webhook API',
    tier: NODE_TIER.APP,
  },
  {
    match: (k) => k === 'knowledgebucket' || k === 'knowledge',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.DATABASE,
    label: 'Knowledge Storage (S3)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'deployer' || k === 'codebuild',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.HAMMER,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'notifier',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.BELL,
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'dashboard' || k === 'clawcenter',
    type: NODE_TYPE.DASHBOARD,
    icon: RESOURCE_ICON.DASHBOARD,
    label: 'ClawCenter (Next.js)',
    tier: NODE_TIER.APP,
    idOverride: 'dashboard',
  },
  {
    match: (k) => k === 'realtimebridge' || k === 'bridge',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.SIGNAL,
    label: 'Realtime Bridge (Lambda)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'realtimebus',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.RADIO,
    label: 'Realtime Bus (IoT Core)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) =>
      ['superclaw', 'coder', 'strategicplanner', 'reflector', 'qa'].includes(k) ||
      k.includes('agent') ||
      k.includes('worker'),
    type: NODE_TYPE.AGENT,
    icon: RESOURCE_ICON.BOT,
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
