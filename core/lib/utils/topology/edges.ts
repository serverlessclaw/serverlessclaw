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
  if (
    lowerProfile === 'memory' ||
    lowerProfile === INFRA_NODE_ID.MEMORY_TABLE ||
    lowerProfile === 'memorytable'
  )
    return INFRA_NODE_ID.MEMORY_TABLE;
  if (
    lowerProfile === 'config' ||
    lowerProfile === INFRA_NODE_ID.CONFIG_TABLE ||
    lowerProfile === 'configtable'
  )
    return INFRA_NODE_ID.CONFIG_TABLE;
  if (
    lowerProfile === 'trace' ||
    lowerProfile === INFRA_NODE_ID.TRACE_TABLE ||
    lowerProfile === 'tracetable'
  )
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

  // MCP Servers (Unified Multiplexer fallback)
  const mcpMultiplexerId = 'mcp-multiplexer';
  const isMcpProfile = [
    'ast',
    'git',
    'filesystem',
    'google-search',
    'puppeteer',
    'fetch',
    'aws',
    'aws-s3',
  ].includes(lowerProfile);

  if (isMcpProfile) return mcpMultiplexerId;

  if (lowerProfile === 'sqs' || lowerProfile === INFRA_NODE_ID.SQS) return INFRA_NODE_ID.SQS;
  if (lowerProfile === 'docs' || lowerProfile === INFRA_NODE_ID.DOCUMENTS)
    return INFRA_NODE_ID.DOCUMENTS;
  if (lowerProfile === 'search' || lowerProfile === INFRA_NODE_ID.OPEN_SEARCH)
    return INFRA_NODE_ID.OPEN_SEARCH;
  if (lowerProfile === 'api' || lowerProfile === INFRA_NODE_ID.API)
    return INFRA_NODE_ID.WEBHOOK_API;

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
    if (toolName.startsWith('ast_')) return ['ast'];
    if (toolName.startsWith('git_')) return ['git'];
    if (toolName.startsWith('filesystem_')) return ['filesystem'];
    if (toolName.startsWith('google-search_')) return ['google-search'];
    if (toolName.startsWith('puppeteer_')) return ['puppeteer'];
    if (toolName.startsWith('fetch_')) return ['fetch'];
    if (toolName.startsWith('aws_')) return ['aws'];
    if (toolName.startsWith('aws-s3_')) return ['aws-s3'];
    if (toolName.includes('memory') || toolName.includes('kv')) return ['memory'];
    if (toolName.includes('config')) return ['config'];
    if (toolName.includes('trace') || toolName.includes('history')) return ['trace'];
    if (toolName.includes('search') || toolName.includes('vector')) return ['search'];
    if (toolName.includes('knowledge') || toolName.includes('rag')) return ['knowledge'];
    if (toolName.includes('deploy') || toolName.includes('build')) return ['codebuild'];
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
      node.id === INFRA_NODE_ID.BUS ||
      node.label.toLowerCase().includes('bus')
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

    const coreTables = [INFRA_NODE_ID.CLAWDB];

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

    const coreBuckets = [INFRA_NODE_ID.STAGING_BUCKET, INFRA_NODE_ID.KNOWLEDGE_BUCKET];

    coreBuckets.forEach((bucket) => {
      if (nodes.some((node) => node.id === bucket)) {
        edges.push({
          id: `dashboard-manage-${bucket}`,
          source: dashboardNode.id,
          target: bucket,
          label: EDGE_LABEL.MANAGE_FILES,
        });
      }
    });

    // H. Deployer (CodeBuild) Links
    const deployerNode = nodes.find(
      (node) => node.id === INFRA_NODE_ID.DEPLOYER || node.id === 'codebuild'
    );
    if (deployerNode) {
      if (nodes.some((node) => node.id === INFRA_NODE_ID.STAGING_BUCKET)) {
        edges.push({
          id: `${deployerNode.id}-staging-link`,
          source: deployerNode.id,
          target: INFRA_NODE_ID.STAGING_BUCKET,
          label: EDGE_LABEL.DEPLOY,
        });
      }
      if (busNode) {
        edges.push({
          id: `${deployerNode.id}-bus-signal`,
          source: deployerNode.id,
          target: busId,
          label: EDGE_LABEL.SIGNAL,
        });
      }
    }

    // I. SQS to EventBridge
    const sqsNode = nodes.find(
      (node) => node.id === INFRA_NODE_ID.SQS || node.label.includes('SQS')
    );
    if (sqsNode && busNode) {
      edges.push({
        id: `sqs-bus-link`,
        source: sqsNode.id,
        target: busId,
        label: EDGE_LABEL.SIGNAL,
      });
    }

    // J. External / Orphan Connectivity
    const githubNode = nodes.find((n) => n.id === 'github');
    const coderNode = nodes.find((n) => n.id === 'coder' || n.id === 'coderagent');
    if (githubNode && coderNode) {
      edges.push({
        id: 'github-coder-read',
        source: githubNode.id,
        target: coderNode.id,
        label: EDGE_LABEL.READ_FILES,
      });
      edges.push({
        id: 'coder-github-commit',
        source: coderNode.id,
        target: githubNode.id,
        label: EDGE_LABEL.DEPLOY,
      });
    }

    if (githubNode && deployerNode) {
      edges.push({
        id: 'github-deployer-source',
        source: githubNode.id,
        target: deployerNode.id,
        label: EDGE_LABEL.DEPLOY,
      });
    }

    const usersNode = nodes.find((n) => n.id === 'external_users');
    if (usersNode) {
      if (apiNode) {
        edges.push({
          id: 'users-api-request',
          source: usersNode.id,
          target: apiNode.id,
          label: EDGE_LABEL.INBOUND,
        });
      }
      edges.push({
        id: 'users-dash-visit',
        source: usersNode.id,
        target: dashboardNode.id,
        label: EDGE_LABEL.INBOUND,
      });
    }

    // K. Notifier to Telegram (Outbound)
    const notifierNode = nodes.find((n) => n.id === 'notifier' || n.id === INFRA_NODE_ID.NOTIFIER);
    const telegramNode = nodes.find((n) => n.id === INFRA_NODE_ID.TELEGRAM);
    if (notifierNode && telegramNode) {
      edges.push({
        id: 'notifier-telegram-send',
        source: notifierNode.id,
        target: telegramNode.id,
        label: EDGE_LABEL.OUTBOUND,
      });
    }
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
      node.id === INFRA_NODE_ID.BUS ||
      node.label.toLowerCase().includes('bus')
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
