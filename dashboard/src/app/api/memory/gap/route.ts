/**
 * @module GapAPI
 * Handles the manual creation of capability gaps from the dashboard interface.
 */
import { withApiHandler, requireFields } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

/**
 * POST handler for creating a new capability gap from the dashboard.
 */
export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');

  requireFields(body, 'details');

  const memory = new DynamoMemory();
  const gapId = Date.now().toString();

  await memory.setGap(gapId, body.details as string, body.metadata as Record<string, unknown> | undefined);

  return { success: true, gapId };
});
