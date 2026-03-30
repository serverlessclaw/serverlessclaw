export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('CONSENSUS#');
    const requests = items.map((item) => ({
      id: item.userId as string,
      title: item.title ?? 'Consensus Request',
      description: item.description ?? '',
      status: item.status ?? 'PENDING',
      mode: item.mode ?? 'MAJORITY',
      votes: item.votes ?? [],
      timestamp: item.timestamp ?? 0,
    }));
    return Response.json({ requests });
  } catch (e) {
    console.error('Error fetching consensus:', e);
    return Response.json({ requests: [] });
  }
}
