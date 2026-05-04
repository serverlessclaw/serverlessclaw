/**
 * @module PrioritizeAPI
 * API for manually adjusting the impact, urgency, and priority of identified system gaps.
 */
import { z } from 'zod';
import { withApiHandler, validateBody } from '@/lib/api-handler';
import { DynamoMemory } from '@claw/core/lib/memory';

export const dynamic = 'force-dynamic';

const PrioritizeSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  timestamp: z.number().int().positive('timestamp must be a positive integer'),
  priority: z.number().int().min(0).max(10).optional(),
  urgency: z.number().int().min(0).max(10).optional(),
  impact: z.number().int().min(0).max(10).optional(),
});

/**
 * POST handler for prioritizing memory insights.
 */
export const POST = withApiHandler(async (body) => {
  const { userId, timestamp, priority, urgency, impact } = validateBody(body, PrioritizeSchema);

  const memory = new DynamoMemory();

  await memory.updateInsightMetadata(userId, timestamp, {
    priority,
    urgency,
    impact,
  });

  return { success: true };
});
