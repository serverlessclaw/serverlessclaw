import type { TopologyNode, IAgentConfig } from '../../types/index';
import { BACKBONE_REGISTRY } from '../../backbone';
import { NODE_TYPE, NODE_TIER, NODE_ICON, INFRA_NODE_ID } from './constants';
import { classifyResource } from './classifiers';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Orphan nodes that should be added to the topology even if they are not
 * explicitly discovered in SST linked resources.
 */
export const ORPHAN_NODES: TopologyNode[] = [
  {
    id: INFRA_NODE_ID.DASHBOARD,
    label: 'ClawCenter (Next.js)',
    icon: NODE_ICON.DASHBOARD,
    type: NODE_TYPE.DASHBOARD,
    tier: NODE_TIER.APP,
  },
  {
    id: INFRA_NODE_ID.SCHEDULER,
    label: 'AWS Scheduler',
    icon: NODE_ICON.CALENDAR,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: INFRA_NODE_ID.TELEGRAM,
    label: 'Telegram',
    icon: NODE_ICON.SEND,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.APP,
  },
  {
    id: INFRA_NODE_ID.HEARTBEAT,
    label: 'Heartbeat Engine',
    icon: NODE_ICON.SIGNAL,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: INFRA_NODE_ID.REALTIME_BRIDGE,
    label: 'Realtime Bridge (Lambda)',
    icon: NODE_ICON.SIGNAL,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: INFRA_NODE_ID.REALTIME_BUS,
    label: 'Realtime Bus (IoT Core)',
    icon: NODE_ICON.RADIO,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.COMM,
  },
  {
    id: 'github',
    label: 'GitHub Repo',
    icon: NODE_ICON.CODE,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.INFRA,
  },
  {
    id: 'external_users',
    label: 'Global Users',
    icon: NODE_ICON.APP,
    type: NODE_TYPE.INFRA,
    tier: NODE_TIER.APP,
  },
];

/**
 * List of sensitive substrings that identify infrastructure configuration or
 * credentials which should be hidden from the public topology view.
 */
const SENSITIVE_RESOURCE_KEYWORDS = [
  'token',
  'password',
  'secret',
  'awsregion',
  'activemodel',
  'activeprovider',
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
  // Exact matches for 'app' and 'key' to avoid over-filtering 'AppConfig' or 'StorageKey'
  const isGenericMetaData = lowerKey === 'app' || lowerKey === 'key' || lowerKey === 'awsregion';

  return SENSITIVE_RESOURCE_KEYWORDS.some((word) => lowerKey.includes(word)) || isGenericMetaData;
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
    // Relaxed check for objects to support 다양한 SST Resource proxy structures
    if (!resourceValue) return;
    if (typeof resourceValue !== 'object' && typeof resourceValue !== 'function') return;

    if (isSensitiveKey(resourceKey)) return;

    const resourceClassifier = classifyResource(resourceKey);
    const nodeType = resourceClassifier?.type ?? NODE_TYPE.INFRA;
    const nodeIcon = resourceClassifier?.icon ?? NODE_ICON.DATABASE;
    const nodeLabel = resourceClassifier?.label ?? resourceKey;
    let nodeTier = resourceClassifier?.tier ?? NODE_TIER.INFRA;

    // Special Promotion Logic (SuperClaw is top tier)
    if (resourceKey.toLowerCase() === 'superclaw') {
      nodeTier = NODE_TIER.APP;
    }

    const nodeId = resourceClassifier?.idOverride ?? resourceKey.toLowerCase();

    // Prevent duplicate nodes (e.g., multiple API routes mapping to the same 'webhookapi' node)
    if (discoveredNodes.some((n) => n.id === nodeId)) {
      return;
    }

    discoveredNodes.push({
      id: nodeId,
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
 * Resolves the current SST stage name from the environment or local state.
 *
 * @returns The resolved stage name (e.g., 'local', 'prod', or a user-specific one like 'dev').
 */
function resolveSstStage(): string {
  let stage = 'local';

  // 1. Explicit environment variable wins
  if (process.env.SST_STAGE) {
    stage = process.env.SST_STAGE;
  } else {
    // 2. Fallback: Read local state file created by sst dev/deploy
    try {
      const root = process.cwd();
      const stageFilePath = join(root, '.sst', 'stage');
      if (existsSync(stageFilePath)) {
        stage = readFileSync(stageFilePath, 'utf8').trim();
      } else {
        // Try parent directory if in a sub-package
        const parentStagePath = join(root, '..', '.sst', 'stage');
        if (existsSync(parentStagePath)) {
          stage = readFileSync(parentStagePath, 'utf8').trim();
        }
      }
    } catch (error) {
      console.debug('[TopologyDiscovery] Failed to resolve stage from file:', error);
    }
  }

  // 3. Enforce allowed stages (local or prod only)
  if (stage !== 'prod' && stage !== 'local') {
    console.warn(`[TopologyDiscovery] Unrecognized stage "${stage}", defaulting to "local"`);
    stage = 'local';
  }

  return stage;
}

/**
 * Performs reflective discovery using the AWS SDK to find resources matching
 * the current application context. Used as a fallback when SST Resource proxy is empty.
 *
 * @returns A promise resolving to an array of discovered TopologyNodes.
 */
export async function discoverAwsNodes(): Promise<TopologyNode[]> {
  const discoveredNodes: TopologyNode[] = [];
  const region = process.env.AWS_REGION || 'ap-southeast-2';
  const app = process.env.SST_APP || 'serverlessclaw';
  const stage = resolveSstStage();
  const prefix = `${app}-${stage}-`.toLowerCase();

  console.info(
    `[TopologyDiscovery] Performing reflective scan for app: ${app}, stage: ${stage}, region: ${region}`
  );

  try {
    // 1. Discover DynamoDB Tables
    const ddb = new DynamoDBClient({ region });
    const { TableNames } = await ddb.send(new ListTablesCommand({}));
    if (TableNames) {
      TableNames.forEach((tableName) => {
        const lowerName = tableName.toLowerCase();
        if (!lowerName.includes(app) || !lowerName.includes(stage)) return;

        // Strip prefix for classification lookup: 'serverlessclaw-local-MemoryTable' -> 'MemoryTable'
        let cleanName = tableName;
        if (lowerName.startsWith(prefix)) {
          cleanName = tableName.slice(prefix.length);
        }

        const classifier = classifyResource(cleanName);
        if (classifier) {
          discoveredNodes.push({
            id: classifier.idOverride ?? cleanName.toLowerCase(),
            type: classifier.type as TopologyNode['type'],
            label: classifier.label ?? cleanName,
            icon: classifier.icon,
            isBackbone: true,
            tier: classifier.tier,
          });
        }
      });
    }

    // 2. Discover S3 Buckets
    const s3 = new S3Client({ region });
    const { Buckets } = await s3.send(new ListBucketsCommand({}));
    if (Buckets) {
      Buckets.forEach((bucket) => {
        if (!bucket.Name) return;
        const lowerName = bucket.Name.toLowerCase();
        if (!lowerName.includes(app) || !lowerName.includes(stage)) return;

        let cleanName = bucket.Name;
        if (lowerName.startsWith(prefix)) {
          cleanName = bucket.Name.slice(prefix.length);
        }

        const classifier = classifyResource(cleanName);
        if (classifier) {
          discoveredNodes.push({
            id: classifier.idOverride ?? cleanName.toLowerCase(),
            type: classifier.type as TopologyNode['type'],
            label: classifier.label ?? bucket.Name,
            icon: classifier.icon,
            isBackbone: true,
            tier: classifier.tier,
          });
        }
      });
    }

    // 3. Discover Lambda Functions
    const lambda = new LambdaClient({ region });
    const { Functions } = await lambda.send(new ListFunctionsCommand({}));
    if (Functions) {
      Functions.forEach((fn) => {
        if (!fn.FunctionName) return;
        const lowerName = fn.FunctionName.toLowerCase();
        if (!lowerName.includes(app) || !lowerName.includes(stage)) return;

        let cleanName = fn.FunctionName;
        if (lowerName.startsWith(prefix)) {
          cleanName = fn.FunctionName.slice(prefix.length);
        }

        const classifier = classifyResource(cleanName);
        if (classifier) {
          discoveredNodes.push({
            id: classifier.idOverride ?? cleanName.toLowerCase(),
            type: classifier.type as TopologyNode['type'],
            label: classifier.label ?? cleanName,
            icon: classifier.icon,
            isBackbone: true,
            tier: classifier.tier,
          });
        }
      });
    }
  } catch (error) {
    console.error('[TopologyDiscovery] AWS Reflective Scan failed:', error);
  }

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
  const COMMON_SUFFIXES = [
    'agent',
    'handler',
    'table',
    'bucket',
    'bus',
    'api',
    'server',
    'multiplexer',
  ];

  for (const [agentId, agentConfig] of Object.entries(BACKBONE_REGISTRY)) {
    const lowerAgentId = agentId.toLowerCase();

    // Find a node that matches either the exact ID or the base name without common suffixes
    const existingNodeIndex = mergedNodes.findIndex((node) => {
      const lowerNodeId = node.id.toLowerCase();
      if (lowerNodeId === lowerAgentId) return true;

      // Try stripping suffixes: 'coderagent' -> 'coder'
      for (const suffix of COMMON_SUFFIXES) {
        if (lowerNodeId.endsWith(suffix) && lowerNodeId.slice(0, -suffix.length) === lowerAgentId) {
          return true;
        }
      }
      return false;
    });

    if (existingNodeIndex !== -1) {
      const node = mergedNodes[existingNodeIndex];
      // Update the ID to the canonical backbone ID for consistent linking
      node.id = lowerAgentId;

      // Update all edges that pointed to the original ID (not possible here, needs to return mappings or handle globally)
      // Actually, discovery happens once, so we can just mutate the node in place and keep its reference.

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
          (agentConfig.isBackbone ? NODE_ICON.BRAIN : NODE_ICON.BOT),
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
      icon: agentConfig.topologyOverride?.icon ?? NODE_ICON.BOT,
      tier: agentConfig.topologyOverride?.tier ?? NODE_TIER.AGENT,
    });
  }

  return finalNodes;
}
