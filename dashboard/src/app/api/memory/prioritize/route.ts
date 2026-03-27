/**
 * @module PrioritizeAPI
 * API for manually adjusting the impact, urgency, and priority of identified system gaps.
 */
import { withApiHandler, requireFields } from '@/lib/api-handler';
import { DynamoMemory } from '@claw/core/lib/memory';

export const dynamic = 'force-dynamic';

/**
 * POST handler for prioritizing memory insights.
 */
export const POST = withApiHandler(async (body) => {
  requireFields(body, 'userId', 'timestamp');

  const memory = new DynamoMemory();

  await memory.updateInsightMetadata(body.userId as string, body.timestamp as number, {
    priority: typeof body.priority === 'number' ? body.priority : undefined,
    urgency: typeof body.urgency === 'number' ? body.urgency : undefined,
    impact: typeof body.impact === 'number' ? body.impact : undefined,
  });

  return { success: true };
});
