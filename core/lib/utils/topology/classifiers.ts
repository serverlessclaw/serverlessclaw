import {
  NODE_TYPE,
  NODE_TIER,
  NODE_ICON,
  TOPOLOGY_LABELS,
  INFRA_NODE_ID,
  MATCH_KEYWORDS,
} from './constants';

/**
 * Resource classifier definition for topology mapping.
 */
export interface ResourceClassifier {
  /** Predicate to match a resource key. */
  match: (key: string) => boolean;
  /** The node type (infra, agent, etc). */
  type: string;
  /** The icon key for the UI. */
  icon: string;
  /** The architectural tier. */
  tier: 'APP' | 'GATEWAY' | 'COMM' | 'AGENT' | 'UTILITY' | 'INFRA';
  /** Optional human-readable label. */
  label?: string;
  /** Optional ID override for stable mapping. */
  idOverride?: string;
}

/**
 * Registry of resource classifiers ordered by matching priority.
 * Used to map resource keys to topology graph nodes.
 */
export const CLASSIFIERS: ResourceClassifier[] = [
  {
    match: (k) => (MATCH_KEYWORDS.BUS as readonly string[]).includes(k),
    type: NODE_TYPE.BUS,
    icon: NODE_ICON.BUS,
    label: TOPOLOGY_LABELS.AGENT_BUS,
    tier: NODE_TIER.COMM,
    idOverride: INFRA_NODE_ID.AGENT_BUS,
  },
  {
    match: (k) => MATCH_KEYWORDS.QUEUE.some((kw) => k.includes(kw)),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.ASYNC_QUEUE,
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k.includes(MATCH_KEYWORDS.API[0]) || k === MATCH_KEYWORDS.API[1],
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.APP,
    label: TOPOLOGY_LABELS.WEBHOOK_API,
    tier: NODE_TIER.GATEWAY,
    idOverride: INFRA_NODE_ID.WEBHOOK_API,
  },
  {
    match: (k) => (MATCH_KEYWORDS.DATABASE as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: TOPOLOGY_LABELS.CLAW_DB,
    tier: NODE_TIER.INFRA,
    idOverride: INFRA_NODE_ID.CLAWDB,
  },
  {
    match: (k) => (MATCH_KEYWORDS.KNOWLEDGE as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: TOPOLOGY_LABELS.KNOWLEDGE_STORAGE,
    tier: NODE_TIER.INFRA,
    idOverride: INFRA_NODE_ID.KNOWLEDGE_BUCKET,
  },
  {
    match: (k) => (MATCH_KEYWORDS.DOCS as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: TOPOLOGY_LABELS.DOCUMENT_STORE,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => MATCH_KEYWORDS.SEARCH.some((kw) => k.includes(kw)),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SEARCH,
    label: TOPOLOGY_LABELS.OPEN_SEARCH,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => (MATCH_KEYWORDS.STAGING as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.DATABASE,
    label: TOPOLOGY_LABELS.STAGING_STORAGE,
    tier: NODE_TIER.INFRA,
    idOverride: INFRA_NODE_ID.STAGING_BUCKET,
  },
  {
    match: (k) => (MATCH_KEYWORDS.DEPLOYER as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.HAMMER,
    tier: NODE_TIER.UTILITY,
    idOverride: INFRA_NODE_ID.DEPLOYER,
  },
  {
    match: (k) => (MATCH_KEYWORDS.NOTIFIER as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.BELL,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => (MATCH_KEYWORDS.DASHBOARD as readonly string[]).includes(k),
    type: NODE_TYPE.DASHBOARD,
    icon: NODE_ICON.DASHBOARD,
    label: TOPOLOGY_LABELS.CLAW_CENTER,
    tier: NODE_TIER.APP,
    idOverride: INFRA_NODE_ID.DASHBOARD,
  },
  {
    match: (k) => (MATCH_KEYWORDS.REALTIME_BRIDGE as readonly string[]).includes(k),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.REALTIME_BRIDGE,
    tier: NODE_TIER.COMM,
    idOverride: INFRA_NODE_ID.REALTIME_BRIDGE,
  },
  {
    match: (k) => (MATCH_KEYWORDS.REALTIME_BUS as readonly string[]).includes(k),
    type: NODE_TYPE.BUS,
    icon: NODE_ICON.RADIO,
    label: TOPOLOGY_LABELS.REALTIME_BUS,
    tier: NODE_TIER.GATEWAY,
    idOverride: INFRA_NODE_ID.REALTIME_BUS,
  },
  {
    match: (k) => (MATCH_KEYWORDS.HEARTBEAT as readonly string[]).includes(k),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.HEARTBEAT_ENGINE,
    tier: NODE_TIER.GATEWAY,
    idOverride: INFRA_NODE_ID.HEARTBEAT,
  },
  {
    match: (k) => (MATCH_KEYWORDS.MONITOR as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.STETHOSCOPE,
    label: TOPOLOGY_LABELS.CONCURRENCY_MONITOR,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => (MATCH_KEYWORDS.EVENTS as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.ZAP,
    label: TOPOLOGY_LABELS.EVENT_HANDLER,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => (MATCH_KEYWORDS.RECOVERY as readonly string[]).includes(k),
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
    match: (k) => k.startsWith(MATCH_KEYWORDS.MCP[0]) && k.endsWith(MATCH_KEYWORDS.MCP[1]),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.GEAR,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === MATCH_KEYWORDS.MCP[2],
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.MCP_WARMUP_HANDLER,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) => (MATCH_KEYWORDS.SUPERCLAW as readonly string[]).includes(k),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.BRAIN,
    tier: NODE_TIER.GATEWAY,
  },
  {
    match: (k) =>
      (MATCH_KEYWORDS.UTILITY_HANDLERS as readonly string[]).includes(k) ||
      k.includes('worker') ||
      k.includes('handler') ||
      k.includes('monitor'),
    type: NODE_TYPE.AGENT,
    icon: NODE_ICON.GEAR,
    tier: NODE_TIER.UTILITY,
  },
  {
    match: (k) =>
      (MATCH_KEYWORDS.AGENTS as readonly string[]).includes(k) ||
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
    match: (k) => (MATCH_KEYWORDS.DLQ as readonly string[]).includes(k),
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.SIGNAL,
    label: TOPOLOGY_LABELS.DEAD_LETTER_QUEUE,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === MATCH_KEYWORDS.REALTIME_BUS[0],
    type: NODE_TYPE.INFRA,
    icon: NODE_ICON.RADIO,
    label: TOPOLOGY_LABELS.REALTIME_BUS_IOT,
    tier: NODE_TIER.GATEWAY,
  },
];

/**
 * Classifies a resource key into a canonical architecture node.
 *
 * @param key The resource key to classify
 * @returns The matching classifier or undefined
 */
export function classifyResource(key: string): ResourceClassifier | undefined {
  const lowerKey = key.toLowerCase();
  return CLASSIFIERS.find((c) => c.match(lowerKey));
}
