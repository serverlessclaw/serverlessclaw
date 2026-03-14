import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { Topology, TopologyNode, TopologyEdge, IAgentConfig } from '../types/index';
import { ConfigManager } from '../registry/config';
import { BACKBONE_REGISTRY } from '../backbone';
import { AgentType } from '../types/agent';

const db = new DynamoDBClient({});

/**
 * Discovers the active system topology by scanning SST resources and Agent configs.
 * Designed to be highly resilient and self-aware.
 */
export async function discoverSystemTopology(): Promise<Topology> {
  const nodes: TopologyNode[] = [
    { id: 'api', type: 'infra', label: 'API Gateway', icon: 'Globe' },
    { id: 'bus', type: 'infra', label: 'AgentBus', icon: 'MessageCircle' },
    { id: 'codebuild', type: 'infra', label: 'BuildEngine', icon: 'Hammer' },
    { id: 'config', type: 'infra', label: 'DynamoDB Config', icon: 'Database' },
    { id: 'memory', type: 'infra', label: 'DynamoDB Memory', icon: 'Database' },
    { id: 'storage', type: 'infra', label: 'Staging Bucket', icon: 'Database' },
    { id: 'traces', type: 'infra', label: 'DynamoDB Traces', icon: 'Database' },
    { id: 'knowledge', type: 'infra', label: 'Knowledge Bucket', icon: 'Database' },
    { id: 'notifier', type: 'infra', label: 'Notifier', icon: 'Bell' },
    { id: 'bridge', type: 'infra', label: 'Realtime Bridge', icon: 'Zap' },
    { id: 'telegram', type: 'infra', label: 'Telegram', icon: 'Send' },
    { id: 'dashboard', type: 'dashboard', label: 'ClawCenter', icon: 'LayoutDashboard' },
  ];

  const edges: TopologyEdge[] = [
    { id: 'api-main', source: 'api', target: AgentType.MAIN, label: 'INBOUND' },
    { id: 'api-bus', source: 'api', target: 'bus', label: 'SIGNAL' },
    { id: 'api-config', source: 'api', target: 'config', label: 'MANAGE' },
    { id: 'bus-codebuild', source: 'bus', target: 'codebuild', label: 'DEPLOY' },
    { id: 'bus-notifier', source: 'bus', target: 'notifier', label: 'EVENT' },
    { id: 'bus-bridge', source: 'bus', target: 'bridge', label: 'EVENT' },
    { id: 'bridge-dashboard', source: 'bridge', target: 'dashboard', label: 'REALTIME' },
    { id: 'dashboard-api', source: 'dashboard', target: 'api', label: 'QUERY' },
    { id: 'main-dashboard-rt', source: AgentType.MAIN, target: 'dashboard', label: 'REALTIME' },
    { id: 'telegram-api', source: 'telegram', target: 'api', label: 'WEBHOOK' },
    { id: 'main-knowledge', source: AgentType.MAIN, target: 'knowledge', label: 'READ_FILES' },
    { id: 'coder-knowledge', source: AgentType.CODER, target: 'knowledge', label: 'MANAGE_FILES' },
    {
      id: 'planner-knowledge',
      source: AgentType.STRATEGIC_PLANNER,
      target: 'knowledge',
      label: 'QUERY',
    },
    {
      id: 'reflector-knowledge',
      source: AgentType.COGNITION_REFLECTOR,
      target: 'knowledge',
      label: 'ARCHIVE',
    },
    { id: 'notifier-telegram', source: 'notifier', target: 'telegram', label: 'OUTBOUND' },
    { id: 'notifier-memory', source: 'notifier', target: 'memory', label: 'SYNC' },
  ];

  // Tool to Resource Mapping Strategy
  const mapToolToResource = (tool: string): string | null => {
    if (tool === 'dispatchTask' || tool === 'listAgents') return 'bus';
    if (tool === 'recallKnowledge' || tool === 'saveMemory') return 'memory';
    if (tool === 'checkConfig' || tool === 'manageGap' || tool === 'reportGap') return 'config';
    if (tool === 'inspectTrace') return 'traces';
    if (tool === 'triggerDeployment') return 'codebuild';
    if (tool === 'sendMessage') return 'notifier';
    if (tool.startsWith('aws-s3_')) return 'storage';
    if (tool.startsWith('knowledge_')) return 'knowledge';
    return null;
  };

  try {
    // 1. Add Backbone Agents (Always include these for resilience)
    for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
      if (!nodes.find((n) => n.id === id)) {
        nodes.push({
          id,
          type: 'agent',
          label: config.name || id,
          icon: config.isBackbone ? 'Brain' : 'Cpu',
          description: config.description,
        });

        // Implicit edges for all backbone agents
        edges.push({ id: `${id}-bus-orch`, source: id, target: 'bus', label: 'ORCHESTRATE' });
        edges.push({ id: `bus-${id}-signal`, source: 'bus', target: id, label: 'SIGNAL' });

        if (config.tools) {
          for (const tool of config.tools) {
            const target = mapToolToResource(tool);
            if (target) {
              const edgeId = `${id}-${target}-use`;
              if (!edges.find((e) => e.id === edgeId)) {
                edges.push({ id: edgeId, source: id, target, label: 'USE' });
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
            type: 'agent',
            label: agent.name || agent.id,
            icon: 'Cpu',
          });

          edges.push({
            id: `${agent.id}-bus-orch`,
            source: agent.id,
            target: 'bus',
            label: 'ORCHESTRATE',
          });
          edges.push({
            id: `bus-${agent.id}-signal`,
            source: 'bus',
            target: agent.id,
            label: 'SIGNAL',
          });

          if (agent.tools && Array.isArray(agent.tools)) {
            for (const tool of agent.tools) {
              const target = mapToolToResource(tool);
              if (target) {
                const edgeId = `${agent.id}-${target}-use`;
                if (!edges.find((e) => e.id === edgeId)) {
                  edges.push({ id: edgeId, source: agent.id, target, label: 'USE' });
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
