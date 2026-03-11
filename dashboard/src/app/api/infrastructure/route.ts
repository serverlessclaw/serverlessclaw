import { Resource } from 'sst';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const infraNodes = [];
    
    // Process EventBus
    if (Resource.AgentBus) {
      infraNodes.push({
        id: 'bus',
        type: 'bus',
        label: 'EventBridge AgentBus',
        description: 'AWS EventBridge. The asynchronous backbone that allows decoupled agents to communicate via event patterns.'
      });
    }

    // Process Memory
    if (Resource.MemoryTable) {
      infraNodes.push({
        id: 'memory',
        type: 'infra',
        iconType: 'Database',
        label: 'DynamoDB Memory',
        description: 'Single-table DynamoDB. Stores session history, distilled knowledge, tactical lessons, and strategic gaps.'
      });
    }

    // CodeBuild isn't fully linked via Resource yet in SST v3, but Deployer role/project exists
    // We can assume if the system is running, the Deployer exists based on our architecture.
    // If we later add Deployer to Resource somehow, we'd check it here. Let's just include it.
    infraNodes.push({
      id: 'codebuild',
      type: 'infra',
      iconType: 'Terminal',
      label: 'AWS CodeBuild',
      description: 'Autonomous deployment engine. Runs "sst deploy" in isolated environments to update the system stack.'
    });

    // Process Staging Bucket
    if (Resource.StagingBucket) {
      infraNodes.push({
        id: 's3',
        type: 'infra',
        iconType: 'Cpu',
        label: 'Staging Bucket',
        description: 'Temporary storage for zipped source code before deployment. Shared between Coder Agent and CodeBuild.'
      });
    }

    return NextResponse.json(infraNodes);
  } catch (error) {
    console.error('Failed to fetch infrastructure:', error);
    return NextResponse.json({ error: 'Failed to fetch infrastructure' }, { status: 500 });
  }
}
