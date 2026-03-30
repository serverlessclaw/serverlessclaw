export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('REPUTATION#');
    const reputation = items.map((item) => ({
      agentId: (item.userId as string).replace('REPUTATION#', ''),
      tasksCompleted: item.tasksCompleted ?? 0,
      tasksFailed: item.tasksFailed ?? 0,
      successRate: item.successRate ?? 0,
      avgLatencyMs: item.avgLatencyMs ?? 0,
      lastActive: item.lastActive ?? 0,
    }));
    return Response.json({ reputation });
  } catch (e) {
    console.error('Error fetching reputation:', e);
    return Response.json({ reputation: [] });
  }
}
