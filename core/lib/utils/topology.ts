import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { Topology, TopologyNode, TopologyEdge, IAgentConfig } from '../types/index';
import { ConfigManager } from '../registry/config';
import { BACKBONE_REGISTRY } from '../backbone';
import { NODE_TYPE, EDGE_LABEL } from './topology/constants';

// Re-export constants for backward compatibility
export { INFRA_NODE_ID, NODE_TYPE, EDGE_LABEL } from './topology/constants';

const db = new DynamoDBClient({});

/**
 * Discovers the active system topology by reflecting on SST resources and Agent configs.
 * Designed to be highly resilient and truly self-aware.
 */
export async function discoverSystemTopology(): Promise<Topology> {
  const { Resource } = await import('sst');
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // 1. Reflective Node Discovery (SST Linked Resources)
  // We iterate over everything linked to this execution context.
  const resourceMap = Resource as any;
  Object.keys(resourceMap).forEach((key) => {
    const res = resourceMap[key];
    if (!res || typeof res !== 'object') return;

    // Categorize based on Naming or Type
    let type: any = NODE_TYPE.INFRA;
    let icon = 'Database';
    let label = key;

    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('agent') ||
      lowerKey.includes('worker') ||
      lowerKey === 'superclaw' ||
      lowerKey === 'coder' ||
      lowerKey === 'strategicplanner' ||
      lowerKey === 'reflector' ||
      lowerKey === 'qa'
    ) {
      type = NODE_TYPE.AGENT;
      icon = 'Cpu';
    } else if (key === 'AgentBus') {
      icon = 'MessageCircle';
      label = 'AgentBus';
    } else if (key.toLowerCase().includes('api')) {
      icon = 'Globe';
    } else if (key === 'Deployer') {
      icon = 'Hammer';
    } else if (key === 'Notifier') {
      icon = 'Bell';
    } else if (key.includes('Bridge') || key.includes('Realtime')) {
      icon = 'Zap';
    }

    nodes.push({
      id: lowerKey,
      type,
      label,
      icon,
      isBackbone: true,
    });
  });

  // 2. Add Critical Non-Linked Nodes (Orphans)
  const orphans = [
    { id: 'scheduler', label: 'AWS Scheduler', icon: 'Calendar', type: NODE_TYPE.INFRA },
    { id: 'telegram', label: 'Telegram', icon: 'Send', type: NODE_TYPE.INFRA },
    { id: 'heartbeat', label: 'Heartbeat Engine', icon: 'Zap', type: NODE_TYPE.INFRA },
  ];

  orphans.forEach((o) => {
    if (!nodes.find((n) => n.id === o.id)) nodes.push(o as any);
  });

  // 3. Dynamic Edge Inference
  // A. Agent to Bus Relationship
  nodes
    .filter((n) => n.type === NODE_TYPE.AGENT)
    .forEach((agent) => {
      edges.push({
        id: `${agent.id}-agentbus-orch`,
        source: agent.id,
        target: 'agentbus',
        label: EDGE_LABEL.ORCHESTRATE,
      });
      edges.push({
        id: `agentbus-${agent.id}-signal`,
        source: 'agentbus',
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
    id: 'heartbeat-agentbus',
    source: 'heartbeat',
    target: 'agentbus',
    label: EDGE_LABEL.SIGNAL,
  });

  // C. API to Bus
  const apiNode = nodes.find(n => n.id.includes('api'));
  if (apiNode) {
    edges.push({
      id: `${apiNode.id}-agentbus`,
      source: apiNode.id,
      target: 'agentbus',
      label: EDGE_LABEL.SIGNAL,
    });
  }

  // D. Telegram to API
  if (apiNode) {
    edges.push({
      id: 'telegram-api',
      source: 'telegram',
      target: apiNode.id,
      label: EDGE_LABEL.WEBHOOK,
    });
  }

  // 4. Map Tool-to-Resource Edges Dynamically
  const mapToolToResource = (tool: string): { target: string; label: string } | null => {
    if (tool === 'dispatchTask' || tool === 'listAgents')
      return { target: 'agentbus', label: EDGE_LABEL.ORCHESTRATE };
    if (tool === 'recallKnowledge' || tool === 'saveMemory')
      return { target: 'memorytable', label: EDGE_LABEL.USE };
    if (tool === 'checkConfig' || tool === 'manageGap' || tool === 'reportGap')
      return { target: 'configtable', label: EDGE_LABEL.USE };
    if (tool === 'inspectTrace') return { target: 'tracetable', label: EDGE_LABEL.USE };
    if (tool === 'triggerDeployment') return { target: 'deployer', label: EDGE_LABEL.USE };
    if (tool === 'sendMessage') return { target: 'notifier', label: EDGE_LABEL.USE };
    if (tool.startsWith('aws-s3_')) return { target: 'stagingbucket', label: EDGE_LABEL.USE };
    if (tool.startsWith('knowledge_')) return { target: 'knowledgebucket', label: EDGE_LABEL.USE };
    if (tool === 'scheduleGoal' || tool === 'cancelGoal' || tool === 'listGoals')
      return { target: 'scheduler', label: EDGE_LABEL.USE };
    return null;
  };

  try {
    // 5. Merge with Backbone Metadata & Dynamic Agents
    for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
      const lowerId = id.toLowerCase();
      const existingNode = nodes.find((n) => n.id === lowerId);

      if (existingNode) {
        // Enrich existing reflective node with registry metadata
        existingNode.label = config.name || existingNode.label;
        existingNode.description = config.description;
      } else {
        nodes.push({
          id: lowerId,
          type: NODE_TYPE.AGENT,
          label: config.name || lowerId,
          icon: config.isBackbone ? 'Brain' : 'Cpu',
          description: config.description,
        });
      }

      // Tool usage edges for backbone agents
      if (config.tools) {
        for (const tool of config.tools) {
          const mapping = mapToolToResource(tool);
          if (mapping) {
            const edgeId = `${lowerId}-${mapping.target}-use`;
            if (!edges.find((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                source: lowerId,
                target: mapping.target,
                label: mapping.label,
              });
            }
          }
        }
      }
    }

    // 6. Add Dynamic Agents from DynamoDB (Wrapped in try-catch for resilience)
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
          if (!agent.id || nodes.find((n) => n.id === agent.id.toLowerCase())) continue;

          const lowerAgentId = agent.id.toLowerCase();
          nodes.push({
            id: lowerAgentId,
            type: NODE_TYPE.AGENT,
            label: agent.name || lowerAgentId,
            icon: 'Cpu',
          });

          edges.push({
            id: `${lowerAgentId}-bus-orch`,
            source: lowerAgentId,
            target: 'agentbus',
            label: EDGE_LABEL.ORCHESTRATE,
          });
          edges.push({
            id: `bus-${lowerAgentId}-signal`,
            source: 'agentbus',
            target: lowerAgentId,
            label: EDGE_LABEL.SIGNAL,
          });

          if (agent.tools && Array.isArray(agent.tools)) {
            for (const tool of agent.tools) {
              const mapping = mapToolToResource(tool);
              if (mapping) {
                const edgeId = `${lowerAgentId}-${mapping.target}-use`;
                if (!edges.find((e) => e.id === edgeId)) {
                  edges.push({
                    id: edgeId,
                    source: lowerAgentId,
                    target: mapping.target,
                    label: mapping.label,
                  });
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
