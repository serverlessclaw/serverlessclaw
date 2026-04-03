import { withApiHandler } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { EvolutionTrack } = await import('@claw/core/lib/types/agent');
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();

    const configItem = (await memory.getConfig('track_evolution_budget')) as { budgets?: unknown[]; maxTotalBudgetUsd?: number } | null;
    const budgets = configItem?.budgets ?? Object.values(EvolutionTrack).map((track) => ({
      track,
      allocated: 2.0,
      spent: 0,
    }));

    return Response.json({ budgets, maxTotalBudgetUsd: configItem?.maxTotalBudgetUsd ?? 10.0 });
  } catch (e) {
    console.error('Error fetching budget:', e);
    return Response.json({ budgets: [], maxTotalBudgetUsd: 10.0 });
  }
}
