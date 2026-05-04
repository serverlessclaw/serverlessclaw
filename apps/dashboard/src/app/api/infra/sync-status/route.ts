import { logger } from '@claw/core/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('BUILD#');
    const syncs = items.slice(0, 20).map((item) => ({
      buildId: item.buildId ?? (item.userId as string),
      status: item.status ?? 'PROGRESS',
      gapIds: item.gapIds ?? [],
      timestamp: item.timestamp ?? 0,
      commitHash: item.commitHash,
    }));
    return Response.json({ syncs });
  } catch (e) {
    logger.error('Error fetching sync status:', e);
    return Response.json({ syncs: [] });
  }
}
