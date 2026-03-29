import { infraSchema as schema } from './schema';
import { discoverSystemTopology } from '../../lib/utils/topology';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Tool to allow agents to inspect the system topology.
 */
export const inspectTopology = {
  ...schema.inspectTopology,
  execute: async (): Promise<string> => {
    try {
      const topology = await discoverSystemTopology();

      // Return a condensed summary to avoid token bloat
      const summary = {
        nodes: topology.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          type: n.type,
          tier: n.tier,
          isBackbone: n.isBackbone,
        })),
        edges: topology.edges.map((e) => ({
          from: e.source,
          to: e.target,
          label: e.label,
        })),
      };

      return JSON.stringify(summary, null, 2);
    } catch (error) {
      return `FAILED_TO_DISCOVER_TOPOLOGY: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Tool to discover available peer agents in the swarm.
 */
export const discoverPeers = {
  ...schema.discoverPeers,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { capability, category, topologyType } = args as {
      capability?: string;
      category?: string;
      topologyType?: string;
    };

    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const allConfigs = await AgentRegistry.getAllConfigs();
      const { ConfigManager } = await import('../../lib/registry/config');

      let agents = Object.values(allConfigs).filter((a) => a.enabled);

      if (category) {
        agents = agents.filter((a) => a.category === category);
      }

      if (capability) {
        const capLower = capability.toLowerCase();
        agents = agents.filter(
          (a) =>
            a.tools?.some((t) => t.toLowerCase().includes(capLower)) ??
            a.id.toLowerCase().includes(capLower)
        );
      }

      // Load existing topology connections
      const existingTopology = await ConfigManager.getRawConfig('swarm_topology');
      const connections = (existingTopology as Record<string, unknown>[]) ?? [];

      const peers = agents.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        tools: a.tools,
        isBackbone: a.isBackbone,
        connections: connections.filter(
          (c: Record<string, unknown>) => c.sourceAgentId === a.id || c.targetAgentId === a.id
        ),
      }));

      return JSON.stringify(
        {
          topologyType: topologyType ?? 'mesh',
          peerCount: peers.length,
          peers,
        },
        null,
        2
      );
    } catch (error) {
      return `FAILED_TO_DISCOVER_PEERS: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Tool to register a peer connection in the swarm topology.
 */
export const registerPeer = {
  ...schema.registerPeer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { sourceAgentId, targetAgentId, topologyType, label } = args as {
      sourceAgentId: string;
      targetAgentId: string;
      topologyType: string;
      label?: string;
    };

    try {
      const { ConfigManager } = await import('../../lib/registry/config');

      // Load existing topology
      const existingTopology = await ConfigManager.getRawConfig('swarm_topology');
      const connections = (existingTopology as Record<string, unknown>[]) ?? [];

      // Check for duplicate connection
      const isDuplicate = connections.some(
        (c: Record<string, unknown>) =>
          c.sourceAgentId === sourceAgentId && c.targetAgentId === targetAgentId
      );

      if (isDuplicate) {
        return `Connection already exists: ${sourceAgentId} -> ${targetAgentId}`;
      }

      const connection = {
        sourceAgentId,
        targetAgentId,
        topologyType,
        label: label ?? `${sourceAgentId} connects to ${targetAgentId}`,
        registeredAt: Date.now(),
      };

      connections.push(connection);

      await ConfigManager.saveRawConfig('swarm_topology', connections);

      return JSON.stringify(
        {
          status: 'registered',
          connection,
          totalConnections: connections.length,
        },
        null,
        2
      );
    } catch (error) {
      return `FAILED_TO_REGISTER_PEER: ${formatErrorMessage(error)}`;
    }
  },
};
