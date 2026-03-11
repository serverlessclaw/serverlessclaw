import { Resource } from 'sst';
import { NextResponse } from 'next/server';
import { AgentRegistry } from '@claw/core/lib/registry';

export async function GET() {
  try {
    // 1. Try to load full system topology from DynamoDB (written by Build Monitor)
    const topology = await AgentRegistry.getFullTopology();
    if (topology && topology.nodes.length > 0) {
      return NextResponse.json(topology);
    }

    // 2. Fallback to legacy infra_config if topology isn't generated yet
    const dynamicInfra = await AgentRegistry.getInfraConfig();
    if (dynamicInfra && dynamicInfra.length > 0) {
      return NextResponse.json({ nodes: dynamicInfra, edges: [] });
    }

    // 3. Static Fallback for initial deployment
    const infraNodes = [];
    if (Resource.AgentBus) {
      infraNodes.push({ id: 'bus', type: 'bus', label: 'EventBridge AgentBus' });
    }
    if (Resource.MemoryTable) {
      infraNodes.push({ id: 'memory', type: 'infra', label: 'DynamoDB Memory' });
    }
    infraNodes.push({ id: 'codebuild', type: 'infra', label: 'AWS CodeBuild' });
    if (Resource.StagingBucket) {
      infraNodes.push({ id: 'storage', type: 'infra', label: 'Staging Bucket' });
    }

    return NextResponse.json({ nodes: infraNodes, edges: [] });
  } catch (error) {
    console.error('Failed to fetch infrastructure:', error);
    return NextResponse.json({ error: 'Failed to fetch infrastructure' }, { status: 500 });
  }
}
