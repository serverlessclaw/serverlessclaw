import type { TopologyNode, IAgentConfig } from '../../types/index';
import { BACKBONE_REGISTRY } from '../../backbone';
import { NODE_TYPE, NODE_TIER, RESOURCE_ICON } from './constants';
import { classifyResource } from './classifiers';

/**
 * Orphan nodes that should be added even if not found in SST resources.
 */
export const ORPHAN_NODES: TopologyNode[] = [
  {
    id: 'dashboard',
    label: 'ClawCenter (Next.js)',
    icon: RESOURCE_ICON.DASHBOARD,
    type: NODE_TYPE.DASHBOARD,
    tier: NODE_TIER.APP,
  },
  {
    id: 'scheduler',
    label: 'AWS Scheduler',
    icon: RESOURCE_ICON.CALENDAR,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.APP,
  }, // USER FEEDBACK: Top Tier
  {
    id: 'telegram',
    label: 'Telegram',
    icon: RESOURCE_ICON.SEND,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.APP,
  },
  {
    id: 'heartbeat',
    label: 'Heartbeat Engine',
    icon: RESOURCE_ICON.SIGNAL,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: 'realtimebridge',
    label: 'Realtime Bridge (Lambda)',
    icon: RESOURCE_ICON.SIGNAL,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: 'realtimebus',
    label: 'Realtime Bus (IoT Core)',
    icon: RESOURCE_ICON.RADIO,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
];

/**
 * Sensitive words that should be filtered out from resource discovery.
 */
const SENSITIVE_WORDS = [
  'token',
  'key',
  'password',
  'secret',
  'awsregion',
  'activemodel',
  'activeprovider',
  'app',
];

/**
 * Checks if a resource key should be filtered out.
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_WORDS.some((word) => lowerKey.includes(word)) || lowerKey === 'app';
}

/**
 * Discovers nodes from SST Linked Resources.
 */
export function discoverSstNodes(resourceMap: Record<string, unknown>): TopologyNode[] {
  const nodes: TopologyNode[] = [];

  Object.keys(resourceMap).forEach((key) => {
    const res = resourceMap[key];
    if (!res || typeof res !== 'object') return;

    if (isSensitiveKey(key)) return;

    const classifier = classifyResource(key);
    const type = classifier?.type ?? NODE_TYPE.INFRA;
    const icon = classifier?.icon ?? RESOURCE_ICON.DATABASE;
    const label = classifier?.label ?? key;
    let tier = classifier?.tier ?? NODE_TIER.INFRA;

    // Special Promotion Logic (SuperClaw is top tier)
    if (key.toLowerCase() === 'superclaw') {
      tier = NODE_TIER.APP;
    }

    nodes.push({
      id: classifier?.idOverride ?? key.toLowerCase(),
      type: type as TopologyNode['type'],
      label,
      icon,
      isBackbone: true,
      tier,
    });
  });

  return nodes;
}

/**
 * Adds orphan nodes that are not in the SST resource map.
 */
export function addOrphanNodes(existingNodes: TopologyNode[]): TopologyNode[] {
  const result = [...existingNodes];

  ORPHAN_NODES.forEach((orphan) => {
    if (!result.find((n) => n.id === orphan.id)) {
      result.push(orphan);
    }
  });

  return result;
}

/**
 * Merges backbone metadata with discovered nodes.
 */
export function mergeBackboneNodes(nodes: TopologyNode[]): TopologyNode[] {
  const result = [...nodes];

  for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
    const lowerId = id.toLowerCase();
    const existingNode = result.find((n) => n.id === lowerId);

    if (existingNode) {
      // Enrichment
      existingNode.label = config.topologyOverride?.label || config.name || existingNode.label;
      existingNode.description = config.description;
      existingNode.icon = config.topologyOverride?.icon ?? existingNode.icon;
      existingNode.tier = config.topologyOverride?.tier ?? existingNode.tier;

      // Reinforce Tier for SuperClaw (it must be at the top), but respect explicit override
      if (lowerId === 'superclaw') {
        existingNode.tier = config.topologyOverride?.tier ?? NODE_TIER.APP;
      }
    } else {
      result.push({
        id: lowerId,
        type: NODE_TYPE.AGENT,
        label: config.topologyOverride?.label || config.name || lowerId,
        icon:
          config.topologyOverride?.icon ??
          (config.isBackbone ? RESOURCE_ICON.BRAIN : RESOURCE_ICON.BOT),
        description: config.description,
        tier:
          config.topologyOverride?.tier ??
          (lowerId === 'superclaw' ? NODE_TIER.APP : NODE_TIER.AGENT),
      });
    }
  }

  return result;
}

/**
 * Adds dynamic agents from database scan results.
 */
export function addDynamicAgents(nodes: TopologyNode[], items: unknown[]): TopologyNode[] {
  const result = [...nodes];

  for (const item of items) {
    const agent = (item as { config?: { M?: Record<string, unknown> } }).config
      ?.M as unknown as IAgentConfig;
    if (!agent.id || result.find((n) => n.id === agent.id.toLowerCase())) continue;

    const lowerAgentId = agent.id.toLowerCase();
    result.push({
      id: lowerAgentId,
      type: NODE_TYPE.AGENT,
      label: agent.topologyOverride?.label || agent.name || lowerAgentId,
      icon: agent.topologyOverride?.icon ?? RESOURCE_ICON.BOT,
      tier: agent.topologyOverride?.tier ?? NODE_TIER.AGENT,
    });
  }

  return result;
}
