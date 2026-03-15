import { toolDefinitions } from './definitions';
import { discoverSystemTopology } from '../lib/utils/topology';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * Tool to allow agents to inspect the system topology.
 * Provides a structured overview of agents, infrastructure, and their connections.
 */
export const inspectTopology = {
  ...toolDefinitions.inspectTopology,
  execute: async (): Promise<string> => {
    try {
      const topology = await discoverSystemTopology();
      
      // Return a condensed summary to avoid token bloat
      const summary = {
        nodes: topology.nodes.map(n => ({
          id: n.id,
          label: n.label,
          type: n.type,
          tier: n.tier,
          isBackbone: n.isBackbone
        })),
        edges: topology.edges.map(e => ({
          from: e.source,
          to: e.target,
          label: e.label
        }))
      };

      return JSON.stringify(summary, null, 2);
    } catch (error) {
      return `FAILED_TO_DISCOVER_TOPOLOGY: ${formatErrorMessage(error)}`;
    }
  },
};
