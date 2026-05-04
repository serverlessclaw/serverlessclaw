/**
 * @module GapPlanAPI
 * Returns the associated evolution plan for a specific capability gap.
 */
import { withApiHandler, ApiError } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = withApiHandler(async (_, req) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { logger } = await import('@claw/core/lib/logger');

  let gapId: string | null = null;
  try {
    const url = new URL(req.url, 'http://localhost');
    gapId = url.searchParams.get('gapId');
  } catch {
    logger.warn('URL parsing failed in GapPlanAPI, attempting fallback', { url: req.url });
  }

  if (!gapId) {
    throw new ApiError('gapId is required', 400);
  }

  const memory = new DynamoMemory();
  const normalizedId = gapId.replace(/^GAP#/, '');

  try {
    const planStr = await memory.getDistilledMemory(`PLAN#${normalizedId}`);
    if (!planStr) {
      return { plan: null };
    }

    return { plan: JSON.parse(planStr) };
  } catch (error) {
    logger.error(`Failed to fetch plan for gap ${normalizedId}:`, error);
    return { plan: null, error: 'Failed to fetch plan' };
  }
});
