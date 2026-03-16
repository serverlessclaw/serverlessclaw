import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { Topology, TopologyNode, TopologyEdge, IAgentConfig } from '../types/index';
import { ConnectionProfile } from '../types/agent';
import { ConfigManager } from '../registry/config';
import { BACKBONE_REGISTRY } from '../backbone';
import { NODE_TYPE, EDGE_LABEL, NODE_TIER, RESOURCE_ICON } from './topology/constants';
import { tools } from '../../tools/index';

// Re-export constants and types for backward compatibility
export { INFRA_NODE_ID, NODE_TYPE, EDGE_LABEL, NODE_TIER } from './topology/constants';
export type { Topology, TopologyNode, TopologyEdge } from '../types/index';

const db = new DynamoDBClient({});

interface ResourceClassifier {
  match: (key: string) => boolean;
  type: string;
  icon: string;
  tier: 'APP' | 'COMM' | 'AGENT' | 'INFRA';
  label?: string;
  idOverride?: string;
}

const CLASSIFIERS: ResourceClassifier[] = [
  {
    match: (k) => k === 'agentbus' || k === 'bus',
    type: NODE_TYPE.BUS,
    icon: RESOURCE_ICON.BUS,
    label: 'AgentBus (EventBridge)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k.includes('api') || k === 'webhookapi',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.APP,
    label: 'Webhook API',
    tier: NODE_TIER.APP,
  },
  {
    match: (k) => k === 'knowledgebucket' || k === 'knowledge',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.DATABASE,
    label: 'Knowledge Storage (S3)',
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'deployer' || k === 'codebuild',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.HAMMER,
    tier: NODE_TIER.INFRA,
  },
  {
    match: (k) => k === 'notifier',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.BELL,
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'dashboard' || k === 'clawcenter',
    type: NODE_TYPE.DASHBOARD,
    icon: RESOURCE_ICON.DASHBOARD,
    label: 'ClawCenter (Next.js)',
    tier: NODE_TIER.APP,
    idOverride: 'dashboard',
  },
  {
    match: (k) => k === 'realtimebridge' || k === 'bridge',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.SIGNAL,
    label: 'Realtime Bridge (Lambda)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) => k === 'realtimebus',
    type: NODE_TYPE.INFRA,
    icon: RESOURCE_ICON.RADIO,
    label: 'Realtime Bus (IoT Core)',
    tier: NODE_TIER.COMM,
  },
  {
    match: (k) =>
      ['superclaw', 'main', 'coder', 'strategicplanner', 'reflector', 'qa'].includes(k) ||
      k.includes('agent') ||
      k.includes('worker'),
    type: NODE_TYPE.AGENT,
    icon: RESOURCE_ICON.BOT,
    tier: NODE_TIER.AGENT,
  },
];

/**
 * Discovers the active system topology by reflecting on SST resources and Agent configs.
 * Designed to be highly resilient and truly self-aware.
 */
export async function discoverSystemTopology(): Promise<Topology> {
  const { Resource } = await import('sst');
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // 1. Reflective Node Discovery (SST Linked Resources)
  const resourceMap = Resource as unknown as Record<string, unknown>;
  Object.keys(resourceMap).forEach((key) => {
    const res = resourceMap[key];
    if (!res || typeof res !== 'object') return;

    const lowerKey = key.toLowerCase();
    const sensitiveWords = [
      'token',
      'key',
      'password',
      'secret',
      'awsregion',
      'activemodel',
      'activeprovider',
      'app',
    ];

    if (sensitiveWords.some((word) => lowerKey.includes(word)) || lowerKey === 'app') {
      return;
    }

    // Find first matching classifier
    const classifier = CLASSIFIERS.find((c) => c.match(lowerKey));

    const type = classifier?.type || NODE_TYPE.INFRA;
    const icon = classifier?.icon || RESOURCE_ICON.DATABASE;
    const label = classifier?.label || key;
    let tier = classifier?.tier || NODE_TIER.INFRA;

    // Special Promotion Logic (SuperClaw is top tier)
    if (lowerKey === 'superclaw' || lowerKey === 'main') {
      tier = NODE_TIER.APP;
    }

    nodes.push({
      id: classifier?.idOverride || lowerKey,
      type: type as TopologyNode['type'],
      label,
      icon,
      isBackbone: true,
      tier,
    });
  });

  // 2. Add Critical Non-Linked Nodes (Orphans)
  const orphans = [
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

  orphans.forEach((o) => {
    if (!nodes.find((n) => n.id === o.id)) nodes.push(o as TopologyNode);
  });

  // 3. Merge with Backbone Metadata & Dynamic Agents
  try {
    for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
      const lowerId = id.toLowerCase();
      const existingNode = nodes.find((n) => n.id === lowerId);

      if (existingNode) {
        // Enrichment
        existingNode.label = config.topologyOverride?.label || config.name || existingNode.label;
        existingNode.description = config.description;
        existingNode.icon = config.topologyOverride?.icon || existingNode.icon;
        existingNode.tier = config.topologyOverride?.tier || existingNode.tier;

        // Reinforce Tier for SuperClaw (it must be at the top), but respect explicit override
        if (lowerId === 'main' || lowerId === 'superclaw') {
          existingNode.tier = config.topologyOverride?.tier || NODE_TIER.APP;
        }
      } else {
        nodes.push({
          id: lowerId,
          type: NODE_TYPE.AGENT,
          label: config.topologyOverride?.label || config.name || lowerId,
          icon:
            config.topologyOverride?.icon ||
            (config.isBackbone ? RESOURCE_ICON.BRAIN : RESOURCE_ICON.BOT),
          description: config.description,
          tier:
            config.topologyOverride?.tier ||
            (lowerId === 'main' || lowerId === 'superclaw' ? NODE_TIER.APP : NODE_TIER.AGENT),
        });
      }
    }

    // Add Dynamic Agents from DynamoDB
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
            label: agent.topologyOverride?.label || agent.name || lowerAgentId,
            icon: agent.topologyOverride?.icon || RESOURCE_ICON.BOT,
            tier: agent.topologyOverride?.tier || NODE_TIER.AGENT,
          });
        }
      }
    } catch (innerErr) {
      console.warn('Failed to scan dynamic agents, proceeding with backbone only:', innerErr);
    }
  } catch (err: unknown) {
    console.error('Critical failure in topology discovery:', err);
  }

  // 4. Dynamic Edge Inference (After all nodes are identified)
  const busNode = nodes.find(
    (n) => n.type === NODE_TYPE.BUS || n.id === 'agentbus' || n.id === 'bus'
  );
  const busId = busNode?.id || 'agentbus';

  const mapProfileToResource = (profile: string): string | null => {
    const p = profile.toLowerCase();
    if (p === ConnectionProfile.BUS || p === 'agentbus') return busId;
    if (p === ConnectionProfile.MEMORY || p === 'memorytable') return 'memorytable';
    if (p === ConnectionProfile.CONFIG || p === 'configtable') return 'configtable';
    if (p === ConnectionProfile.TRACE || p === 'tracetable') return 'tracetable';
    if (p === ConnectionProfile.STORAGE || p === 'stagingbucket') return 'stagingbucket';
    if (p === ConnectionProfile.CODEBUILD || p === ConnectionProfile.DEPLOYER || p === 'deployer')
      return 'deployer';
    if (p === ConnectionProfile.KNOWLEDGE || p === 'knowledgebucket') return 'knowledgebucket';
    if (p === 'scheduler') return 'scheduler';
    if (p === 'notifier') return 'notifier';
    return null;
  };

  const mapToolToResources = (toolName: string): string[] => {
    const tool = tools[toolName];
    if (!tool || !tool.connectionProfile) {
      if (toolName === 'sendMessage') return ['notifier'];
      // Agents use both S3 buckets depending on the task (Deployment vs Knowledge)
      if (toolName.startsWith('aws-s3_')) return ['stagingbucket', 'knowledgebucket'];
      return [];
    }
    return tool.connectionProfile;
  };

  // A. Agent <-> Bus Relationship
  nodes
    .filter(
      (n) =>
        n.type === NODE_TYPE.AGENT || n.id === 'monitor' || n.id === 'superclaw' || n.id === 'main'
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
    const mainAgent = nodes.find((n) => n.id === 'superclaw' || n.id === 'main');
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

  // 5. Backbone Profile and Tool based edges
  for (const [id, config] of Object.entries(BACKBONE_REGISTRY)) {
    const lowerId = id.toLowerCase();

    if (config.connectionProfile) {
      for (const profile of config.connectionProfile) {
        const target = mapProfileToResource(profile);
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
        const targets = mapToolToResources(toolName);
        for (const profile of targets) {
          const targetId = mapProfileToResource(profile);
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

  // 6. Dynamic Agent Tool based edges
  // Note: For simplicity and brevity, we assume dynamic agent tool edges are handled during discovery if available.
  // Re-scanning DynamoDB for tools if needed, but Step 3 and 5 cover the majority.

  return { nodes, edges };
}
