import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const INFRA_IDS = {
  BUS: 'bus',
  MEMORY: 'memory',
  CODEBUILD: 'codebuild',
  STORAGE: 'storage',
} as const;

const INFRA_LABELS = {
  BUS: 'EventBridge AgentBus',
  MEMORY: 'DynamoDB Memory',
  CODEBUILD: 'AWS CodeBuild',
  STORAGE: 'Staging Bucket',
} as const;

/**
 * GET handler for infrastructure topology.
 * Discovers and returns the system's infrastructure nodes and their relationships.
 * 
 * @returns A promise that resolves to a NextResponse containing the topology JSON.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const { discoverSystemTopology } = await import('@claw/core/handlers/monitor');

    // 1. Try to load full system topology from DynamoDB (persisted by Build Monitor)
    const topology = await AgentRegistry.getFullTopology();
    
    // 2. Perform Live Discovery to get latest state
    console.log('Performing live topology discovery...');
    const liveTopology = await discoverSystemTopology();

    // 3. Merge Strategies
    if (liveTopology && liveTopology.nodes.length > 0) {
      // If we have live data, it's generally preferred over persisted data for dev/local
      // but we might want to merge if persisted has something live is missing
      return NextResponse.json(liveTopology);
    }

    if (topology && topology.nodes.length > 0) {
      return NextResponse.json(topology);
    }

    // 4. Static Fallback for initial deployment or broken environments
    const infraNodes: any[] = [];
    if (Resource.AgentBus) {
      infraNodes.push({ id: INFRA_IDS.BUS, type: 'bus', label: INFRA_LABELS.BUS });
    }
    if (Resource.MemoryTable) {
      infraNodes.push({ id: INFRA_IDS.MEMORY, type: 'infra', label: INFRA_LABELS.MEMORY });
    }
    infraNodes.push({ id: INFRA_IDS.CODEBUILD, type: 'infra', label: INFRA_LABELS.CODEBUILD, description: 'AWS CodeBuild Service' });

    return NextResponse.json({ nodes: infraNodes, edges: [] });
  } catch (error) {
    console.error('Failed to fetch infrastructure:', error);
    return NextResponse.json({ error: 'Failed to fetch infrastructure' }, { status: 500 });
  }
}
