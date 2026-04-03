/**
 * @module GapAPI
 * Handles the manual creation of capability gaps from the dashboard interface.
 */
import { z } from 'zod';
import { withApiHandler, validateBody } from '@/lib/api-handler';
import type { InsightMetadata } from '@claw/core/lib/types/memory';

export const dynamic = 'force-dynamic';

const CreateGapSchema = z.object({
  details: z.string().min(1, 'details is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function toInsightMetadata(metadata?: Record<string, unknown>): InsightMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' ? value : fallback;

  const asString = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim().length > 0 ? value : fallback;

  return {
    category: asString(metadata.category, 'strategic_gap'),
    confidence: asNumber(metadata.confidence, 5),
    impact: asNumber(metadata.impact, 5),
    complexity: asNumber(metadata.complexity, 5),
    risk: asNumber(metadata.risk, 5),
    urgency: asNumber(metadata.urgency, 5),
    priority: asNumber(metadata.priority, 5),
    hitCount: typeof metadata.hitCount === 'number' ? metadata.hitCount : undefined,
    lastAccessed: typeof metadata.lastAccessed === 'number' ? metadata.lastAccessed : undefined,
    retryCount: typeof metadata.retryCount === 'number' ? metadata.retryCount : undefined,
    lastAttemptTime:
      typeof metadata.lastAttemptTime === 'number' ? metadata.lastAttemptTime : undefined,
  };
}

/**
 * POST handler for creating a new capability gap from the dashboard.
 */
export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { details, metadata } = validateBody(body, CreateGapSchema);

  const memory = new DynamoMemory();
  const gapId = Date.now().toString();

  await memory.setGap(gapId, details, toInsightMetadata(metadata));

  return { success: true, gapId };
});
