/**
 * @module MemoryStatusAPI
 * Handlers for transitioning the status of capability gaps (e.g., OPEN -> PLANNED).
 */
import { z } from 'zod';
import { withApiHandler, validateBody } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

const UpdateGapStatusSchema = z.object({
  gapId: z.string().min(1, 'gapId is required'),
  status: z.enum(['OPEN', 'PLANNED', 'PROGRESS', 'DEPLOYED', 'DONE', 'FAILED', 'ARCHIVED']),
});

/**
 * POST handler for updating the status of a capability gap.
 */
export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { gapId, status } = validateBody(body, UpdateGapStatusSchema);

  const memory = new DynamoMemory();
  await memory.updateGapStatus(gapId, status);

  return { success: true, gapId, status };
});
