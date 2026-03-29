import { toolDefinitions } from './definitions/index';
import { ConfigManager } from '../lib/registry/config';
import { DYNAMO_KEYS } from '../lib/constants';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * Discovers other agents (peers) in the swarm based on capabilities or categories.
 */
export const DISCOVER_PEERS = {
  ...toolDefinitions.discoverPeers,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { capability, category } = args as { capability?: string; category?: string };

    try {
      const { AgentRegistry } = await import('../lib/registry');
      const configs = await AgentRegistry.getAllConfigs();

      let peers = Object.values(configs).filter((a) => a.enabled && a.id !== 'superclaw');

      if (category) {
        peers = peers.filter(
          (p) =>
            p.name.toLowerCase().includes(category.toLowerCase()) ||
            (p.description && p.description.toLowerCase().includes(category.toLowerCase()))
        );
      }

      if (capability) {
        peers = peers.filter((p) =>
          p.systemPrompt.toLowerCase().includes(capability.toLowerCase())
        );
      }

      if (peers.length === 0) return 'No matching peers found in the current swarm topology.';

      return (
        `Discovered ${peers.length} active peers:\n` +
        peers.map((p) => `- [${p.id}] ${p.name}: ${p.description || 'No description'}`).join('\n')
      );
    } catch (error) {
      return `Failed to discover peers: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Registers a bidirectional connection between two agents in the swarm topology.
 */
export const REGISTER_PEER = {
  ...toolDefinitions.registerPeer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { peerId, relationship, agentId } = args as {
      peerId: string;
      relationship: string;
      agentId?: string;
    };
    const sourceAgentId = agentId ?? 'superclaw';

    try {
      const topology = ((await ConfigManager.getRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY)) as any) || {
        nodes: [],
        edges: [],
      };

      // Add or update the edge in the topology graph
      const edgeId = `${sourceAgentId}->${peerId}`;
      const existingEdgeIndex = (topology.edges || []).findIndex(
        (e: { id: string }) => e.id === edgeId
      );

      const newEdge = {
        id: edgeId,
        source: sourceAgentId,
        target: peerId,
        label: relationship,
        metadata: { registeredAt: Date.now() },
      };

      if (existingEdgeIndex >= 0) {
        topology.edges[existingEdgeIndex] = newEdge;
      } else {
        if (!topology.edges) topology.edges = [];
        topology.edges.push(newEdge);
      }

      await ConfigManager.saveRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY, topology);

      return `Successfully registered peer relationship: ${sourceAgentId} --(${relationship})--> ${peerId}`;
    } catch (error) {
      return `Failed to register peer: ${formatErrorMessage(error)}`;
    }
  },
};
