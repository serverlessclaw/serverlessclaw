export const dynamic = 'force-dynamic';

interface AgentHealthRecord {
  agentId: string;
  score: number;
  taskCompletionRate: number;
  reasoningCoherence: number;
  errorRate: number;
  memoryFragmentation: number;
  anomalies: unknown[];
}

export async function GET() {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('HEALTH#');

    if (!items || items.length === 0) {
      return Response.json({ agents: [], message: 'No health data recorded' });
    }

    const agents: AgentHealthRecord[] = items
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).score === 'number'
      )
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          agentId:
            typeof record.userId === 'string' ? record.userId.replace('HEALTH#', '') : 'unknown',
          score: typeof record.score === 'number' ? record.score : 0,
          taskCompletionRate:
            typeof record.taskCompletionRate === 'number' ? record.taskCompletionRate : 0,
          reasoningCoherence:
            typeof record.reasoningCoherence === 'number' ? record.reasoningCoherence : 0,
          errorRate: typeof record.errorRate === 'number' ? record.errorRate : 0,
          memoryFragmentation:
            typeof record.memoryFragmentation === 'number' ? record.memoryFragmentation : 0,
          anomalies: Array.isArray(record.anomalies) ? record.anomalies : [],
        };
      });

    return Response.json({ agents });
  } catch (e) {
    console.error('Error fetching cognitive health:', e);
    return new Response(JSON.stringify({ agents: [], error: 'Failed to fetch health data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
