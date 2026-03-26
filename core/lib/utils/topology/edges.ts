import type { TopologyNode, TopologyEdge } from '../../types/index';
import { EDGE_LABEL, NODE_TYPE } from './constants';
import { BACKBONE_REGISTRY } from '../../backbone';

/**
 * Maps a connection profile to a resource ID.
 */
export function mapProfileToResource(profile: string, busId: string): string | null {
  const p = profile.toLowerCase();
  if (p === 'bus' || p === 'agentbus') return busId;
  if (p === 'memory' || p === 'memorytable') return 'memorytable';
  if (p === 'config' || p === 'configtable') return 'configtable';
  if (p === 'trace' || p === 'tracetable') return 'tracetable';
  if (p === 'storage' || p === 'stagingbucket') return 'stagingbucket';
  if (p === 'codebuild' || p === 'deployer' || p === 'deployer') return 'deployer';
  if (p === 'knowledge' || p === 'knowledgebucket') return 'knowledgebucket';
  if (p === 'scheduler') return 'scheduler';
  if (p === 'notifier') return 'notifier';
  return null;
}

// Lazy-loaded TOOLS reference to break circular dependency with tools/index
let _toolsCache: Record<string, { connectionProfile?: string[] }> | null = null;

async function getTools(): Promise<Record<string, { connectionProfile?: string[] }>> {
  if (!_toolsCache) {
    const { TOOLS } = await import('../../../tools/index');
    _toolsCache = TOOLS;
  }
  return _toolsCache;
}

/**
 * Maps a tool name to its connected resources.
 */
export async function mapToolToResources(toolName: string): Promise<string[]> {
  if (!toolName) return [];
  const TOOLS = await getTools();
  const tool = TOOLS[toolName];
  if (!tool || !tool.connectionProfile) {
    if (toolName === 'sendMessage') return ['notifier'];
    // Agents use both S3 buckets depending on the task (Deployment vs Knowledge)
    if (toolName.startsWith('aws-s3_')) return ['stagingbucket', 'knowledgebucket'];
    return [];
  }
  return tool.connectionProfile;
}

/**
 * Infers edges based on node relationships.
 */
export function inferNodeEdges(nodes: TopologyNode[]): TopologyEdge[] {
  const edges: TopologyEdge[] = [];
  const busNode = nodes.find(
    (n) => n.type === NODE_TYPE.BUS || n.id === 'agentbus' || n.id === 'bus'
  );
  const busId = busNode?.id ?? 'agentbus';

  // A. Agent <-> Bus Relationship
  nodes
    .filter((n) => n.type === NODE_TYPE.AGENT || n.id === 'monitor' || n.id === 'superclaw')
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
    id: 'scheduler-heartbeat',
    source: 'scheduler',
    target: 'heartbeat',
    label: EDGE_LABEL.HEARTBEAT,
  });
  edges.push({
    id: `heartbeat-${busId}`,
    source: 'heartbeat',
    target: busId,
    label: EDGE_LABEL.SIGNAL,
  });

  // C. API/Webhook to Bus
  const apiNode = nodes.find((n) => n.id === 'webhookapi' || n.id.includes('api'));
  if (apiNode) {
    edges.push({
      id: `${apiNode.id}-${busId}`,
      source: apiNode.id,
      target: busId,
      label: EDGE_LABEL.SIGNAL,
    });

    // D. Telegram to API
    edges.push({
      id: 'telegram-api',
      source: 'telegram',
      target: apiNode.id,
      label: EDGE_LABEL.WEBHOOK,
    });
  }

  // E. Real-time Signaling Flow
  if (nodes.find((n) => n.id === 'realtimebridge') && busNode) {
    edges.push({
      id: `${busId}-realtimebridge`,
      source: busId,
      target: 'realtimebridge',
      label: EDGE_LABEL.SIGNAL,
    });
  }

  if (nodes.find((n) => n.id === 'realtimebridge') && nodes.find((n) => n.id === 'realtimebus')) {
    edges.push({
      id: 'realtimebridge-realtimebus',
      source: 'realtimebridge',
      target: 'realtimebus',
      label: EDGE_LABEL.REALTIME,
    });
  }

  const dashboardNode = nodes.find((n) => n.type === NODE_TYPE.DASHBOARD);
  if (dashboardNode) {
    if (nodes.find((n) => n.id === 'realtimebus')) {
      edges.push({
        id: `realtimebus-${dashboardNode.id}`,
        source: 'realtimebus',
        target: dashboardNode.id,
        label: EDGE_LABEL.REALTIME,
      });
    }

    // F. Dashboard (ClawCenter) explicitly linked to SuperClaw
    const mainAgent = nodes.find((n) => n.id === 'superclaw');
    if (mainAgent) {
      edges.push({
        id: `${dashboardNode.id}-${mainAgent.id}`,
        source: dashboardNode.id,
        target: mainAgent.id,
        label: EDGE_LABEL.ORCHESTRATE,
      });
    }

    // G. Dashboard Outgoing to API and Infra
    if (apiNode) {
      edges.push({
        id: `${dashboardNode.id}-${apiNode.id}`,
        source: dashboardNode.id,
        target: apiNode.id,
        label: EDGE_LABEL.INBOUND,
      });
    }

    ['memorytable', 'configtable', 'tracetable'].forEach((table) => {
      if (nodes.find((n) => n.id === table)) {
        edges.push({
          id: `${dashboardNode.id}-${table}`,
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
 */
export async function inferBackboneEdges(nodes: TopologyNode[]): Promise<TopologyEdge[]> {
  const edges: TopologyEdge[] = [];
  const busNode = nodes.find(
    (n) => n.type === NODE_TYPE.BUS || n.id === 'agentbus' || n.id === 'bus'
  );
  const busId = busNode?.id ?? 'agentbus';

  for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
    const lowerId = id.toLowerCase();

    if (config.connectionProfile) {
      for (const profile of config.connectionProfile) {
        const target = mapProfileToResource(profile, busId);
        if (target && nodes.find((n) => n.id === target)) {
          const edgeId = `${lowerId}-${target}-profile`;
          if (!edges.find((e) => e.id === edgeId)) {
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
          if (targetId && nodes.find((n) => n.id === targetId)) {
            const edgeId = `${lowerId}-${targetId}-tool`;
            if (!edges.find((e) => e.id === edgeId)) {
              edges.push({ id: edgeId, source: lowerId, target: targetId, label: EDGE_LABEL.USE });
            }
          }
        }
      }
    }
  }

  return edges;
}
