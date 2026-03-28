import type { TopologyNode, IAgentConfig } from '../../types/index';
import { BACKBONE_REGISTRY } from '../../backbone';
import { NODE_TYPE, NODE_TIER, RESOURCE_ICON, INFRA_NODE_ID } from './constants';
import { classifyResource } from './classifiers';

/**
 * Orphan nodes that should be added to the topology even if they are not
 * explicitly discovered in SST linked resources.
 */
export const ORPHAN_NODES: TopologyNode[] = [
  {
    id: INFRA_NODE_ID.DASHBOARD,
    label: 'ClawCenter (Next.js)',
    icon: RESOURCE_ICON.DASHBOARD,
    type: NODE_TYPE.DASHBOARD,
    tier: NODE_TIER.APP,
  },
  {
    id: INFRA_NODE_ID.SCHEDULER,
    label: 'AWS Scheduler',
    icon: RESOURCE_ICON.CALENDAR,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.APP,
  },
  {
    id: INFRA_NODE_ID.TELEGRAM,
    label: 'Telegram',
    icon: RESOURCE_ICON.SEND,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.APP,
  },
  {
    id: INFRA_NODE_ID.HEARTBEAT,
    label: 'Heartbeat Engine',
    icon: RESOURCE_ICON.SIGNAL,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: INFRA_NODE_ID.REALTIME_BRIDGE,
    label: 'Realtime Bridge (Lambda)',
    icon: RESOURCE_ICON.SIGNAL,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: INFRA_NODE_ID.REALTIME_BUS,
    label: 'Realtime Bus (IoT Core)',
    icon: RESOURCE_ICON.RADIO,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
];

/**
 * List of sensitive substrings that identify infrastructure configuration or
 * credentials which should be hidden from the public topology view.
 */
const SENSITIVE_RESOURCE_KEYWORDS = [
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
 * Determines if a resource key contains sensitive information or is metadata
 * that should not be visualized as a node.
 *
 * @param key The resource key name.
 * @returns True if the key is sensitive or excluded.
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_RESOURCE_KEYWORDS.some((word) => lowerKey.includes(word)) || lowerKey === 'app';
}

/**
 * Discovers topology nodes by analyzing SST Linked Resources.
 *
 * @param resourceMap The record of resources from SST.
 * @returns An array of discovered TopologyNodes.
 */
export function discoverSstNodes(resourceMap: Record<string, unknown>): TopologyNode[] {
  const discoveredNodes: TopologyNode[] = [];

  Object.keys(resourceMap).forEach((resourceKey) => {
    const resourceValue = resourceMap[resourceKey];
    if (!resourceValue || typeof resourceValue !== 'object') return;

    if (isSensitiveKey(resourceKey)) return;

    const resourceClassifier = classifyResource(resourceKey);
    const nodeType = resourceClassifier?.type ?? NODE_TYPE.INFRA;
    const nodeIcon = resourceClassifier?.icon ?? RESOURCE_ICON.DATABASE;
    const nodeLabel = resourceClassifier?.label ?? resourceKey;
    let nodeTier = resourceClassifier?.tier ?? NODE_TIER.INFRA;

    // Special Promotion Logic (SuperClaw is top tier)
    if (resourceKey.toLowerCase() === 'superclaw') {
      nodeTier = NODE_TIER.APP;
    }

    discoveredNodes.push({
      id: resourceClassifier?.idOverride ?? resourceKey.toLowerCase(),
      type: nodeType as TopologyNode['type'],
      label: nodeLabel,
      icon: nodeIcon,
      isBackbone: true,
      tier: nodeTier,
    });
  });

  return discoveredNodes;
}

/**
 * Ensures required orphan nodes are present in the final node list.
 *
 * @param existingNodes The currently discovered nodes.
 * @returns The augmented list of nodes including orphans.
 */
export function addOrphanNodes(existingNodes: TopologyNode[]): TopologyNode[] {
  const updatedNodes = [...existingNodes];

  ORPHAN_NODES.forEach((orphanNode) => {
    if (!updatedNodes.some((node) => node.id === orphanNode.id)) {
      updatedNodes.push(orphanNode);
    }
  });

  return updatedNodes;
}

/**
 * Enriches discovered nodes with metadata from the hardcoded backbone registry.
 *
 * @param nodes The current list of topology nodes.
 * @returns The enriched list of nodes.
 */
export function mergeBackboneNodes(nodes: TopologyNode[]): TopologyNode[] {
  const mergedNodes = [...nodes];

  for (const [agentId, agentConfig] of Object.entries(BACKBONE_REGISTRY)) {
    const lowerAgentId = agentId.toLowerCase();
    const existingNodeIndex = mergedNodes.findIndex((node) => node.id === lowerAgentId);

    if (existingNodeIndex !== -1) {
      const node = mergedNodes[existingNodeIndex];
      // Enrichment from backbone config
      node.label = agentConfig.topologyOverride?.label || agentConfig.name || node.label;
      node.description = agentConfig.description;
      node.icon = agentConfig.topologyOverride?.icon ?? node.icon;
      node.tier = agentConfig.topologyOverride?.tier ?? node.tier;

      // Reinforce Tier for SuperClaw (top-level orchestration)
      if (lowerAgentId === 'superclaw') {
        node.tier = agentConfig.topologyOverride?.tier ?? NODE_TIER.APP;
      }
    } else {
      mergedNodes.push({
        id: lowerAgentId,
        type: NODE_TYPE.AGENT,
        label: agentConfig.topologyOverride?.label || agentConfig.name || lowerAgentId,
        icon:
          agentConfig.topologyOverride?.icon ??
          (agentConfig.isBackbone ? RESOURCE_ICON.BRAIN : RESOURCE_ICON.BOT),
        description: agentConfig.description,
        tier:
          agentConfig.topologyOverride?.tier ??
          (lowerAgentId === 'superclaw' ? NODE_TIER.APP : NODE_TIER.AGENT),
      });
    }
  }

  return mergedNodes;
}

/**
 * Adds dynamic agent instances discovered from the database.
 *
 * @param nodes The current list of nodes.
 * @param items Raw database scan results containing agent configurations.
 * @returns The final set of topology nodes.
 */
export function addDynamicAgents(nodes: TopologyNode[], items: unknown[]): TopologyNode[] {
  const finalNodes = [...nodes];

  for (const dbItem of items) {
    const agentConfig = (dbItem as { config?: { M?: Record<string, unknown> } }).config
      ?.M as unknown as IAgentConfig;

    if (!agentConfig.id) continue;

    const lowerAgentId = agentConfig.id.toLowerCase();
    if (finalNodes.some((node) => node.id === lowerAgentId)) continue;

    finalNodes.push({
      id: lowerAgentId,
      type: NODE_TYPE.AGENT,
      label: agentConfig.topologyOverride?.label || agentConfig.name || lowerAgentId,
      icon: agentConfig.topologyOverride?.icon ?? RESOURCE_ICON.BOT,
      tier: agentConfig.topologyOverride?.tier ?? NODE_TIER.AGENT,
    });
  }

  return finalNodes;
}
