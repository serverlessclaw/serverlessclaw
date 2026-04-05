import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

/**
 * GET handler for infrastructure topology.
 * Discovers and returns the system's infrastructure nodes and their relationships.
 *
 * @returns A promise that resolves to a NextResponse containing the topology JSON.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const { discoverSystemTopology } = await import('@claw/core/lib/utils/topology');

    // 1. Diagnostic Logging for Environment
    const resourceKeys = Object.keys(Resource);
    console.info(`[InfrastructureAPI] SST Resource keys found: ${resourceKeys.length}`, resourceKeys);
    if (resourceKeys.length === 0) {
      console.warn('[InfrastructureAPI] Resource Proxy is empty. This usually means the dashboard was started without "sst dev". Falling back to reflective SDK scan...');
    }

    // 2. Try to load full system topology from DynamoDB (persisted by Build Monitor)
    // In dev mode, we prefer live discovery to see changes immediately.
    let storedTopology;
    try {
      storedTopology = await AgentRegistry.getFullTopology();
    } catch (e) {
      console.warn('[InfrastructureAPI] Failed to fetch stored topology:', e);
    }

    // 3. Perform Live Discovery (Reflective)
    const liveTopology = await discoverSystemTopology();

    // 4. Merge Strategies: Use liveTopology if stored is missing or if we are in dev mode
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev || !storedTopology || (storedTopology.nodes?.length ?? 0) === 0) {
      return NextResponse.json(liveTopology);
    }

    return NextResponse.json(storedTopology);
  } catch (error) {
    console.error('[InfrastructureAPI] Critical failure:', error);
    return NextResponse.json({ error: 'Failed to fetch infrastructure' }, { status: 500 });
  }
}
