/**
 * @module SystemBurnRateAPI
 * Returns the current token burn-rate for the entire system.
 * Aggregates usage across all agents for the current UTC day.
 */
import { withApiHandler } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = withApiHandler(async () => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { CONFIG_DEFAULTS } = await import('@claw/core/lib/config/config-defaults');
  const { ConfigManager } = await import('@claw/core/lib/registry/config');
  
  const memory = new DynamoMemory();
  
  // List all token rollups for today
  // Format: TOKEN_ROLLUP#<agentId>
  const rollups = await memory.listByPrefix('TOKEN_ROLLUP#');
  
  const now = Date.now();
  const todayStart = new Date(now).setUTCHours(0, 0, 0, 0);
  
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let invocationCount = 0;
  
  for (const item of rollups) {
    // Only count rollups for today
    if ((item.timestamp as number) >= todayStart) {
      totalInputTokens += (item.totalInputTokens as number) ?? 0;
      totalOutputTokens += (item.totalOutputTokens as number) ?? 0;
      invocationCount += (item.invocationCount as number) ?? 0;
    }
  }
  
  const totalTokens = totalInputTokens + totalOutputTokens;
  
  // Get budget from config
  const budget = await ConfigManager.getTypedConfig(
    'global_token_budget',
    CONFIG_DEFAULTS.GLOBAL_TOKEN_BUDGET.code
  );
  
  // Calculate burn rate (tokens per hour over the day so far)
  const hoursSoFar = Math.max(1, (now - todayStart) / (1000 * 60 * 60));
  const burnRatePerHour = Math.round(totalTokens / hoursSoFar);
  
  return {
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    invocationCount,
    dailyBudget: budget,
    burnRatePerHour,
    usageRatio: budget > 0 ? (totalTokens / budget) : 0,
    timestamp: now
  };
});
