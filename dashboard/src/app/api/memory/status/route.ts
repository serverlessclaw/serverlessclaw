/**
 * @module MemoryStatusAPI
 * Handlers for transitioning the status of capability gaps (e.g., OPEN -> PLANNED).
 */
import { withApiHandler, requireFields, requireEnum } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

/**
 * POST handler for updating the status of a capability gap.
 */
export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { GapStatus } = await import('@claw/core/lib/types');

  requireFields(body, 'gapId', 'status');
  requireEnum(body.status, Object.values(GapStatus) as string[], 'status');

  const memory = new DynamoMemory();
  await memory.updateGapStatus(body.gapId as string, body.status as typeof GapStatus[keyof typeof GapStatus]);

  return { success: true, gapId: body.gapId, status: body.status };
});
