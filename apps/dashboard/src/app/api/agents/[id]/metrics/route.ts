import { NextRequest } from 'next/server';
import { logger } from '@claw/core/lib/logger';
import { BaseMemoryProvider } from '@claw/core/lib/memory/base';
import { TIME } from '@claw/core/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/[id]/metrics
 * Fetches time-series performance metrics for a specific agent.
 * Query Params:
 *  - grain: 'hourly' | 'daily' (default: 'hourly')
 *  - days: number (default: 7)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const grain = searchParams.get('grain') === 'daily' ? 'DAY' : 'HOUR';
  const days = parseInt(searchParams.get('days') || '7', 10);

  try {
    const memory = new BaseMemoryProvider();
    const now = Date.now();
    const startTime = now - days * TIME.MS_PER_DAY;

    const pk = `METRIC#${grain}#${id}`;

    // Query metrics within the requested window
    const items = await memory.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': pk,
        ':start': startTime,
        ':end': now,
      },
      ScanIndexForward: true,
    });

    const metrics = ((items || []) as Array<Record<string, unknown>>).map((item) => {
      const successCount = (item.successCount as number) ?? 0;
      const failureCount = (item.failureCount as number) ?? 0;
      const totalDurationMs = (item.totalDurationMs as number) ?? 0;
      const totalTasks = successCount + failureCount;

      return {
        timestamp: item.timestamp as number,
        successCount,
        failureCount,
        totalDurationMs,
        avgLatencyMs: totalTasks > 0 ? totalDurationMs / totalTasks : 0,
        successRate: totalTasks > 0 ? successCount / totalTasks : 0,
        errorDistribution: (item.errorDistribution as Record<string, number>) ?? {},
        promptHash: item.promptHash as string,
        version: item.version as number,
      };
    });

    return Response.json({ metrics });
  } catch (e) {
    logger.error(`[API] Error fetching metrics for agent ${id}:`, e);
    return Response.json({ error: 'Failed to fetch metrics', metrics: [] }, { status: 500 });
  }
}
