/**
 * @module GapAPI
 * Handles the manual creation of capability gaps from the dashboard interface.
 */
import { z } from 'zod';
import { withApiHandler, validateBody } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

const CreateGapSchema = z.object({
  details: z.string().min(1, 'details is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST handler for creating a new capability gap from the dashboard.
 */
export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { details, metadata } = validateBody(body, CreateGapSchema);

  const memory = new DynamoMemory();
  const gapId = Date.now().toString();

  await memory.setGap(gapId, details, metadata);

  return { success: true, gapId };
});
