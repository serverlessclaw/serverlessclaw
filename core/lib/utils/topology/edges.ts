import type { TopologyNode, TopologyEdge } from '../../types/index';
import { EDGE_LABEL, NODE_TYPE, INFRA_NODE_ID } from './constants';
import { BACKBONE_REGISTRY } from '../../backbone';

/**
 * Maps a connection profile string to a canonical resource ID.
 *
 * @param profile The profile name (e.g., 'bus', 'memory').
 * @param busId The active bus ID for the environment.
 * @returns The target resource ID or null if not recognized.
 */
export function mapProfileToResource(profile: string, busId: string): string | null {
  const lowerProfile = profile.toLowerCase();

  if (lowerProfile === 'bus' || lowerProfile === INFRA_NODE_ID.AGENT_BUS) return busId;
  if (lowerProfile === 'memory' || lowerProfile === INFRA_NODE_ID.MEMORY_TABLE)
    return INFRA_NODE_ID.MEMORY_TABLE;
  if (lowerProfile === 'config' || lowerProfile === INFRA_NODE_ID.CONFIG_TABLE)
    return INFRA_NODE_ID.CONFIG_TABLE;
  if (lowerProfile === 'trace' || lowerProfile === INFRA_NODE_ID.TRACE_TABLE)
    return INFRA_NODE_ID.TRACE_TABLE;
  if (lowerProfile === 'storage' || lowerProfile === INFRA_NODE_ID.STAGING_BUCKET)
    return INFRA_NODE_ID.STAGING_BUCKET;
  if (
    lowerProfile === 'codebuild' ||
    lowerProfile === 'deployer' ||
    lowerProfile === INFRA_NODE_ID.DEPLOYER
  )
    return INFRA_NODE_ID.DEPLOYER;
  if (lowerProfile === 'knowledge' || lowerProfile === INFRA_NODE_ID.KNOWLEDGE_BUCKET)
    return INFRA_NODE_ID.KNOWLEDGE_BUCKET;
  if (lowerProfile === INFRA_NODE_ID.SCHEDULER) return INFRA_NODE_ID.SCHEDULER;
  if (lowerProfile === INFRA_NODE_ID.NOTIFIER) return INFRA_NODE_ID.NOTIFIER;

  // MCP Servers
  if (lowerProfile === 'git') return INFRA_NODE_ID.MCP_GIT;
  if (lowerProfile === 'filesystem') return INFRA_NODE_ID.MCP_FILESYSTEM;
  if (lowerProfile === 'google-search') return INFRA_NODE_ID.MCP_GOOGLE_SEARCH;
  if (lowerProfile === 'puppeteer') return INFRA_NODE_ID.MCP_PUPPETEER;
  if (lowerProfile === 'fetch') return INFRA_NODE_ID.MCP_FETCH;
  if (lowerProfile === 'aws') return INFRA_NODE_ID.MCP_AWS;
  if (lowerProfile === 'aws-s3') return INFRA_NODE_ID.MCP_AWS_S3;

  return null;
}

// Lazy-loaded TOOLS reference to break circular dependency with tools/index
let _toolsCache: Record<string, { connectionProfile?: string[] }> | null = null;

/**
 * Loads and caches tool definitions asynchronously.
 */
async function getTools(): Promise<Record<string, { connectionProfile?: string[] }>> {
  if (!_toolsCache) {
    const { TOOLS } = await import('../../../tools/index');
    _toolsCache = TOOLS;
  }
  return _toolsCache;
}

/**
 * Maps a tool name to its connected resources based on its connection profile.
 *
 * @param toolName The name of the tool.
 * @returns An array of resource identifiers.
 */
export async function mapToolToResources(toolName: string): Promise<string[]> {
  if (!toolName) return [];
  const toolDefinitions = await getTools();
  const tool = toolDefinitions[toolName];

  if (!tool || !tool.connectionProfile) {
    if (toolName === 'sendMessage') return [INFRA_NODE_ID.NOTIFIER];
    // Agents use both S3 buckets depending on the task (Deployment vs Knowledge)
    if (toolName.startsWith('git_')) return ['git'];
    if (toolName.startsWith('filesystem_')) return ['filesystem'];
    if (toolName.startsWith('google-search_')) return ['google-search'];
    if (toolName.startsWith('puppeteer_')) return ['puppeteer'];
    if (toolName.startsWith('fetch_')) return ['fetch'];
    if (toolName.startsWith('aws_')) return ['aws'];
    if (toolName.startsWith('aws-s3_')) return ['aws-s3'];
    return [];
  }

  return tool.connectionProfile;
}

/**
 * Infers logical edges based on known node types and common architectural patterns.
 *
 * @param nodes List of identified topology nodes.
 * @returns An array of generated topology edges.
 */
export function inferNodeEdges(nodes: TopologyNode[]): TopologyEdge[] {
  const edges: TopologyEdge[] = [];
  const busNode = nodes.find(
    (node) =>
      node.type === NODE_TYPE.BUS ||
      node.id === INFRA_NODE_ID.AGENT_BUS ||
      node.id === INFRA_NODE_ID.BUS
  );
  const busId = busNode?.id ?? INFRA_NODE_ID.AGENT_BUS;

  // A. Agent <-> Bus Relationship
  nodes
    .filter(
      (node) => node.type === NODE_TYPE.AGENT || node.id === 'monitor' || node.id === 'superclaw'
    )
    .forEach((agent) => {
      edges.push({
        id: `${agent.id}-${busId}-orch`,
        source: agent.id,
        target: busId,
        label: EDGE_LABEL.ORCHESTRATE,
      });
      edges.push({
        id: `${busId}-${agent.id}-signal`,
        source: busId,
        target: agent.id,
        label: EDGE_LABEL.SIGNAL,
      });
    });

  // B. Scheduler to Heartbeat
  edges.push({
    id: 'base-scheduler-heartbeat',
    source: INFRA_NODE_ID.SCHEDULER,
    target: INFRA_NODE_ID.HEARTBEAT,
    label: EDGE_LABEL.HEARTBEAT,
  });
  edges.push({
    id: `heartbeat-${busId}`,
    source: INFRA_NODE_ID.HEARTBEAT,
    target: busId,
    label: EDGE_LABEL.SIGNAL,
  });

  // C. API/Webhook to Bus
  const apiNode = nodes.find(
    (node) => node.id === INFRA_NODE_ID.WEBHOOK_API || node.id.includes(INFRA_NODE_ID.API)
  );
  if (apiNode) {
    edges.push({
      id: `${apiNode.id}-${busId}`,
      source: apiNode.id,
      target: busId,
      label: EDGE_LABEL.SIGNAL,
    });

    // D. Telegram to API
    edges.push({
      id: 'telegram-api-link',
      source: INFRA_NODE_ID.TELEGRAM,
      target: apiNode.id,
      label: EDGE_LABEL.WEBHOOK,
    });
  }

  // E. Real-time Signaling Flow
  const hasRealtimeBridge = nodes.some((node) => node.id === INFRA_NODE_ID.REALTIME_BRIDGE);
  const hasRealtimeBus = nodes.some((node) => node.id === INFRA_NODE_ID.REALTIME_BUS);

  if (hasRealtimeBridge && busNode) {
    edges.push({
      id: `${busId}-realtime-bridge`,
      source: busId,
      target: INFRA_NODE_ID.REALTIME_BRIDGE,
      label: EDGE_LABEL.SIGNAL,
    });
  }

  if (hasRealtimeBridge && hasRealtimeBus) {
    edges.push({
      id: 'realtime-bridge-to-bus',
      source: INFRA_NODE_ID.REALTIME_BRIDGE,
      target: INFRA_NODE_ID.REALTIME_BUS,
      label: EDGE_LABEL.REALTIME,
    });
  }

  const dashboardNode = nodes.find((node) => node.type === NODE_TYPE.DASHBOARD);
  if (dashboardNode) {
    if (hasRealtimeBus) {
      edges.push({
        id: `realtime-bus-to-dash`,
        source: INFRA_NODE_ID.REALTIME_BUS,
        target: dashboardNode.id,
        label: EDGE_LABEL.REALTIME,
      });
    }

    // F. Dashboard explicitly linked to SuperClaw
    const mainAgent = nodes.find((node) => node.id === 'superclaw');
    if (mainAgent) {
      edges.push({
        id: `dashboard-superclaw-link`,
        source: dashboardNode.id,
        target: mainAgent.id,
        label: EDGE_LABEL.ORCHESTRATE,
      });
    }

    // G. Dashboard Outgoing to API and Infra
    if (apiNode) {
      edges.push({
        id: `dashboard-api-link`,
        source: dashboardNode.id,
        target: apiNode.id,
        label: EDGE_LABEL.INBOUND,
      });
    }

    const coreTables = [
      INFRA_NODE_ID.MEMORY_TABLE,
      INFRA_NODE_ID.CONFIG_TABLE,
      INFRA_NODE_ID.TRACE_TABLE,
    ];

    coreTables.forEach((table) => {
      if (nodes.some((node) => node.id === table)) {
        edges.push({
          id: `dashboard-query-${table}`,
          source: dashboardNode.id,
          target: table,
          label: EDGE_LABEL.QUERY,
        });
      }
    });
  }

  return edges;
}

/**
 * Infers edges based on backbone registry configuration.
 *
 * @param nodes List of identified topology nodes.
 * @returns A promise resolving to an array of backbone topology edges.
 */
export async function inferBackboneEdges(nodes: TopologyNode[]): Promise<TopologyEdge[]> {
  const edges: TopologyEdge[] = [];
  const busNode = nodes.find(
    (node) =>
      node.type === NODE_TYPE.BUS ||
      node.id === INFRA_NODE_ID.AGENT_BUS ||
      node.id === INFRA_NODE_ID.BUS
  );
  const busId = busNode?.id ?? INFRA_NODE_ID.AGENT_BUS;

  for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
    const lowerId = id.toLowerCase();

    if (config.connectionProfile) {
      for (const profile of config.connectionProfile) {
        const target = mapProfileToResource(profile, busId);
        if (target && nodes.some((node) => node.id === target)) {
          const edgeId = `${lowerId}-${target}-profile-link`;
          if (!edges.some((edge) => edge.id === edgeId)) {
            edges.push({ id: edgeId, source: lowerId, target, label: EDGE_LABEL.USE });
          }
        }
      }
    }

    if (config.tools) {
      for (const toolName of config.tools) {
        const targets = await mapToolToResources(toolName);
        for (const profile of targets) {
          const targetId = mapProfileToResource(profile, busId);
          if (targetId && nodes.some((node) => node.id === targetId)) {
            const edgeId = `${lowerId}-${targetId}-tool-link`;
            if (!edges.some((edge) => edge.id === edgeId)) {
              edges.push({ id: edgeId, source: lowerId, target: targetId, label: EDGE_LABEL.USE });
            }
          }
        }
      }
    }
  }

  return edges;
}
