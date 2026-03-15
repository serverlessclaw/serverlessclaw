import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { Topology, TopologyNode, TopologyEdge, IAgentConfig } from '../types/index';
import { ConfigManager } from '../registry/config';
import { BACKBONE_REGISTRY } from '../backbone';
import { AgentType } from '../types/agent';

const db = new DynamoDBClient({});

/** Canonical identifiers for well-known infrastructure and platform nodes. */
const INFRA_NODE_ID = {
  API: 'api',
  BUS: 'bus',
  CODEBUILD: 'codebuild',
  CONFIG: 'config',
  MEMORY: 'memory',
  STORAGE: 'storage',
  TRACES: 'traces',
  KNOWLEDGE: 'knowledge',
  NOTIFIER: 'notifier',
  BRIDGE: 'bridge',
  TELEGRAM: 'telegram',
  DASHBOARD: 'dashboard',
} as const;

/** Node type discriminators for the topology graph renderer. */
const NODE_TYPE = {
  INFRA: 'infra' as const,
  AGENT: 'agent' as const,
  DASHBOARD: 'dashboard' as const,
};

/** Standard edge label vocabulary for topology links. */
const EDGE_LABEL = {
  INBOUND: 'INBOUND',
  SIGNAL: 'SIGNAL',
  MANAGE: 'MANAGE',
  DEPLOY: 'DEPLOY',
  EVENT: 'EVENT',
  REALTIME: 'REALTIME',
  QUERY: 'QUERY',
  WEBHOOK: 'WEBHOOK',
  READ_FILES: 'READ_FILES',
  MANAGE_FILES: 'MANAGE_FILES',
  ARCHIVE: 'ARCHIVE',
  OUTBOUND: 'OUTBOUND',
  SYNC: 'SYNC',
  ORCHESTRATE: 'ORCHESTRATE',
  USE: 'USE',
} as const;

/**
 * Discovers the active system topology by scanning SST resources and Agent configs.
 * Designed to be highly resilient and self-aware.
 */
export async function discoverSystemTopology(): Promise<Topology> {
  const nodes: TopologyNode[] = [
    { id: INFRA_NODE_ID.API, type: NODE_TYPE.INFRA, label: 'API Gateway', icon: 'Globe' },
    { id: INFRA_NODE_ID.BUS, type: NODE_TYPE.INFRA, label: 'AgentBus', icon: 'MessageCircle' },
    { id: INFRA_NODE_ID.CODEBUILD, type: NODE_TYPE.INFRA, label: 'BuildEngine', icon: 'Hammer' },
    { id: INFRA_NODE_ID.CONFIG, type: NODE_TYPE.INFRA, label: 'DynamoDB Config', icon: 'Database' },
    { id: INFRA_NODE_ID.MEMORY, type: NODE_TYPE.INFRA, label: 'DynamoDB Memory', icon: 'Database' },
    { id: INFRA_NODE_ID.STORAGE, type: NODE_TYPE.INFRA, label: 'Staging Bucket', icon: 'Database' },
    { id: INFRA_NODE_ID.TRACES, type: NODE_TYPE.INFRA, label: 'DynamoDB Traces', icon: 'Database' },
    { id: INFRA_NODE_ID.KNOWLEDGE, type: NODE_TYPE.INFRA, label: 'Knowledge Bucket', icon: 'Database' },
    { id: INFRA_NODE_ID.NOTIFIER, type: NODE_TYPE.INFRA, label: 'Notifier', icon: 'Bell' },
    { id: INFRA_NODE_ID.BRIDGE, type: NODE_TYPE.INFRA, label: 'Realtime Bridge', icon: 'Zap' },
    { id: INFRA_NODE_ID.TELEGRAM, type: NODE_TYPE.INFRA, label: 'Telegram', icon: 'Send' },
    { id: INFRA_NODE_ID.DASHBOARD, type: NODE_TYPE.DASHBOARD, label: 'ClawCenter', icon: 'LayoutDashboard' },
  ];

  const edges: TopologyEdge[] = [
    { id: 'api-main', source: INFRA_NODE_ID.API, target: AgentType.MAIN, label: EDGE_LABEL.INBOUND },
    { id: 'api-bus', source: INFRA_NODE_ID.API, target: INFRA_NODE_ID.BUS, label: EDGE_LABEL.SIGNAL },
    { id: 'api-config', source: INFRA_NODE_ID.API, target: INFRA_NODE_ID.CONFIG, label: EDGE_LABEL.MANAGE },
    { id: 'bus-codebuild', source: INFRA_NODE_ID.BUS, target: INFRA_NODE_ID.CODEBUILD, label: EDGE_LABEL.DEPLOY },
    { id: 'bus-notifier', source: INFRA_NODE_ID.BUS, target: INFRA_NODE_ID.NOTIFIER, label: EDGE_LABEL.EVENT },
    { id: 'bus-bridge', source: INFRA_NODE_ID.BUS, target: INFRA_NODE_ID.BRIDGE, label: EDGE_LABEL.EVENT },
    { id: 'bridge-dashboard', source: INFRA_NODE_ID.BRIDGE, target: INFRA_NODE_ID.DASHBOARD, label: EDGE_LABEL.REALTIME },
    { id: 'dashboard-api', source: INFRA_NODE_ID.DASHBOARD, target: INFRA_NODE_ID.API, label: EDGE_LABEL.QUERY },
    { id: 'main-dashboard-rt', source: AgentType.MAIN, target: INFRA_NODE_ID.DASHBOARD, label: EDGE_LABEL.REALTIME },
    { id: 'telegram-api', source: INFRA_NODE_ID.TELEGRAM, target: INFRA_NODE_ID.API, label: EDGE_LABEL.WEBHOOK },
    { id: 'main-knowledge', source: AgentType.MAIN, target: INFRA_NODE_ID.KNOWLEDGE, label: EDGE_LABEL.READ_FILES },
    { id: 'coder-knowledge', source: AgentType.CODER, target: INFRA_NODE_ID.KNOWLEDGE, label: EDGE_LABEL.MANAGE_FILES },
    {
      id: 'planner-knowledge',
      source: AgentType.STRATEGIC_PLANNER,
      target: INFRA_NODE_ID.KNOWLEDGE,
      label: EDGE_LABEL.QUERY,
    },
    {
      id: 'reflector-knowledge',
      source: AgentType.COGNITION_REFLECTOR,
      target: INFRA_NODE_ID.KNOWLEDGE,
      label: EDGE_LABEL.ARCHIVE,
    },
    { id: 'notifier-telegram', source: INFRA_NODE_ID.NOTIFIER, target: INFRA_NODE_ID.TELEGRAM, label: EDGE_LABEL.OUTBOUND },
    { id: 'notifier-memory', source: INFRA_NODE_ID.NOTIFIER, target: INFRA_NODE_ID.MEMORY, label: EDGE_LABEL.SYNC },
  ];

  // Tool to Resource Mapping Strategy
  const mapToolToResource = (tool: string): string | null => {
    if (tool === 'dispatchTask' || tool === 'listAgents') return INFRA_NODE_ID.BUS;
    if (tool === 'recallKnowledge' || tool === 'saveMemory') return INFRA_NODE_ID.MEMORY;
    if (tool === 'checkConfig' || tool === 'manageGap' || tool === 'reportGap') return INFRA_NODE_ID.CONFIG;
    if (tool === 'inspectTrace') return INFRA_NODE_ID.TRACES;
    if (tool === 'triggerDeployment') return INFRA_NODE_ID.CODEBUILD;
    if (tool === 'sendMessage') return INFRA_NODE_ID.NOTIFIER;
    if (tool.startsWith('aws-s3_')) return INFRA_NODE_ID.STORAGE;
    if (tool.startsWith('knowledge_')) return INFRA_NODE_ID.KNOWLEDGE;
    return null;
  };

  try {
    // 1. Add Backbone Agents (Always include these for resilience)
    for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
      if (!nodes.find((n) => n.id === id)) {
        nodes.push({
          id,
          type: NODE_TYPE.AGENT,
          label: config.name || id,
          icon: config.isBackbone ? 'Brain' : 'Cpu',
          description: config.description,
        });

        // Implicit edges for all backbone agents
        edges.push({ id: `${id}-bus-orch`, source: id, target: INFRA_NODE_ID.BUS, label: EDGE_LABEL.ORCHESTRATE });
        edges.push({ id: `bus-${id}-signal`, source: INFRA_NODE_ID.BUS, target: id, label: EDGE_LABEL.SIGNAL });

        if (config.tools) {
          for (const tool of config.tools) {
            const target = mapToolToResource(tool);
            if (target) {
              const edgeId = `${id}-${target}-use`;
              if (!edges.find((e) => e.id === edgeId)) {
                edges.push({ id: edgeId, source: id, target, label: EDGE_LABEL.USE });
              }
            }
          }
        }
      }
    }

    // 2. Add Dynamic Agents from DynamoDB (Wrapped in try-catch for resilience)
    try {
      const tableName = await ConfigManager.resolveTableName();
      if (tableName) {
        const { Items = [] } = await db.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: 'begins_with(id, :p)',
            ExpressionAttributeValues: { ':p': { S: 'agent' } },
          })
        );

        for (const item of Items) {
          const agent = (item.config?.M ? item.config.M : {}) as unknown as IAgentConfig;
          if (!agent.id || nodes.find((n) => n.id === agent.id)) continue;

          nodes.push({
            id: agent.id,
            type: NODE_TYPE.AGENT,
            label: agent.name || agent.id,
            icon: 'Cpu',
          });

          edges.push({
            id: `${agent.id}-bus-orch`,
            source: agent.id,
            target: INFRA_NODE_ID.BUS,
            label: EDGE_LABEL.ORCHESTRATE,
          });
          edges.push({
            id: `bus-${agent.id}-signal`,
            source: INFRA_NODE_ID.BUS,
            target: agent.id,
            label: EDGE_LABEL.SIGNAL,
          });

          if (agent.tools && Array.isArray(agent.tools)) {
            for (const tool of agent.tools) {
              const target = mapToolToResource(tool);
              if (target) {
                const edgeId = `${agent.id}-${target}-use`;
                if (!edges.find((e) => e.id === edgeId)) {
                  edges.push({ id: edgeId, source: agent.id, target, label: EDGE_LABEL.USE });
                }
              }
            }
          }
        }
      }
    } catch (innerErr) {
      console.warn('Failed to scan dynamic agents, proceeding with backbone only:', innerErr);
    }
  } catch (err) {
    console.error('Critical failure in topology discovery:', err);
  }

  return { nodes, edges };
}
