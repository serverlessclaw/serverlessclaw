export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('HEALTH#');
    const agents = items.map((item) => ({
      agentId: (item.userId as string).replace('HEALTH#', ''),
      score: item.score ?? 85,
      taskCompletionRate: item.taskCompletionRate ?? 0.9,
      reasoningCoherence: item.reasoningCoherence ?? 8.0,
      errorRate: item.errorRate ?? 0.05,
      memoryFragmentation: item.memoryFragmentation ?? 0.2,
      anomalies: item.anomalies ?? [],
    }));
    return Response.json({ agents });
  } catch (e) {
    console.error('Error fetching cognitive health:', e);
    return Response.json({ agents: [] });
  }
}
