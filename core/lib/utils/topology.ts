import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { Topology, TopologyNode, TopologyEdge } from '../types/system';
import { ConfigManager } from '../registry/config';
import {
  discoverSstNodes,
  addOrphanNodes,
  mergeBackboneNodes,
  addDynamicAgents,
  discoverAwsNodes,
} from './topology/nodes';
import { inferNodeEdges, inferBackboneEdges } from './topology/edges';

// Default client for backward compatibility - can be overridden for testing
const defaultDb = new DynamoDBClient({});

// Allow tests to inject a custom DynamoDB client
let injectedDb: DynamoDBClient | undefined;

/**
 * Sets a custom DynamoDB client for testing purposes.
 * @param db - The DynamoDB client to use
 */
export function setDbClient(db: DynamoDBClient): void {
  injectedDb = db;
}

function getDbClient(): DynamoDBClient {
  return injectedDb ?? defaultDb;
}

/**
 * Discovers the active system topology by reflecting on SST resources and Agent configs.
 * Designed to be highly resilient and truly self-aware.
 * @since 2026-03-19
 */
export async function discoverSystemTopology(): Promise<Topology> {
  const { Resource } = await import('sst');
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // 1. Reflective discovery of SST resources (linked links)
  let sstNodes = discoverSstNodes(Resource as unknown as Record<string, unknown>);

  // 1.1 Fallback to manual AWS SDK scan if Resource proxy is empty (e.g. non-SST dev mode)
  if (sstNodes.length === 0) {
    console.info(
      '[TopologyDiscovery] SST Resource proxy empty. Falling back to AWS reflective scan...'
    );
    sstNodes = await discoverAwsNodes();
  }
  nodes.push(...sstNodes);

  // 2. Add Critical Non-Linked Nodes (Orphans)
  const addedOrphanNodes = addOrphanNodes(nodes);

  // 3. Merge with Backbone Metadata & Dynamic Agents
  const mergedNodes = mergeBackboneNodes(addedOrphanNodes);

  // Add dynamic agents from DynamoDB
  let finalNodes = mergedNodes;
  try {
    const tableName = await ConfigManager.resolveTableName();
    if (tableName) {
      const { Items = [] } = await getDbClient().send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'begins_with(id, :p)',
          ExpressionAttributeValues: { ':p': { S: 'agent' } },
        })
      );

      finalNodes = addDynamicAgents(mergedNodes, Items);
    }
  } catch (innerErr) {
    console.warn('Failed to scan dynamic agents, proceeding with backbone only:', innerErr);
  }

  try {
    // 4. Dynamic Edge Inference (After all nodes are identified)
    // Add node-based edges
    edges.push(...inferNodeEdges(finalNodes));

    // 5. Backbone Profile and Tool based edges
    edges.push(...(await inferBackboneEdges(finalNodes)));
  } catch (err: unknown) {
    console.error('Critical failure in topology discovery:', err);
  }

  // 6. Dynamic Agent Tool based edges (handled in step 3 for dynamic agents)

  return { nodes: finalNodes, edges };
}
