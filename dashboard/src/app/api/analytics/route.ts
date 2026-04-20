import { logger } from '@claw/core/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Math.min(parseInt(url.searchParams.get('days') ?? '7', 10), 90);
    const agentId = url.searchParams.get('agentId') ?? undefined;

    const { TokenTracker } = await import('@claw/core/lib/metrics/token-usage');
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();

    const agents = ['superclaw', 'coder', 'strategic-planner', 'cognition-reflector', 'qa'];
    const targetAgents = agentId ? [agentId] : agents;

    // Fetch token rollups per agent in parallel
    const tokenData: Record<string, unknown[]> = {};
    await Promise.all(
      targetAgents.map(async (agent) => {
        const rollups = await TokenTracker.getRollupRange(agent, days);
        tokenData[agent] = rollups.map((r) => ({
          date: new Date(r.timestamp).toISOString().slice(0, 10),
          totalInputTokens: r.totalInputTokens,
          totalOutputTokens: r.totalOutputTokens,
          invocationCount: r.invocationCount,
          avgTokensPerInvocation: r.avgTokensPerInvocation,
          successCount: r.successCount,
        }));
      })
    );

    // Fetch tool usage from registry
    const toolUsageItem = await memory.getConfig('tool_usage_global');
    const toolUsage = toolUsageItem
      ? Object.entries(toolUsageItem)
          .filter(([key]) => key !== 'userId' && key !== 'timestamp' && key !== 'type')
          .map(([toolName, stats]) => ({
            toolName,
            ...(typeof stats === 'object' && stats !== null ? stats : {}),
          }))
      : [];

    // Fetch recent cognitive health metrics
    const healthItems = await memory.listByPrefix('HEALTH#METRIC#');
    const recentMetrics = healthItems
      .filter((item) => {
        const ts = (item.timestamp as number) ?? 0;
        const cutoff = Date.now() - days * 86400000;
        return ts > cutoff;
      })
      .map((item) => ({
        agentId: ((item.userId as string) ?? '').replace('HEALTH#METRIC#', ''),
        metricName: item.metricName,
        value: item.value,
        timestamp: item.timestamp,
      }));

    return Response.json({
      tokenUsage: tokenData,
      toolUsage,
      cognitiveMetrics: recentMetrics,
      meta: { days, agentId: agentId ?? 'all' },
    });
  } catch (e) {
    logger.error('Error fetching analytics:', e);
    return Response.json(
      {
        error: 'Failed to fetch analytics data',
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
