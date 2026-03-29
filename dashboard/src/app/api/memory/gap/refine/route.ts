/**
 * @module GapRefineAPI
 * Handles interactive gap refinement from the dashboard.
 * Supports editing description, priority, impact, and rejection with reason.
 */
import { z } from 'zod';
import { withApiHandler, validateBody } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

const RefineGapSchema = z.object({
  gapId: z.string().min(1, 'gapId is required'),
  content: z.string().optional(),
  impact: z.number().min(1).max(10).optional(),
  priority: z.number().min(1).max(10).optional(),
  rejectionReason: z.string().optional(),
});

export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { InsightCategory } = await import('@claw/core/lib/types/memory');
  const { gapId, content, impact, priority, rejectionReason } = validateBody(body, RefineGapSchema);

  const memory = new DynamoMemory();
  const normalizedId = gapId.replace(/^GAP#/, '');

  // Update gap metadata if provided
  if (content !== undefined || impact !== undefined || priority !== undefined) {
    const metadata: Record<string, unknown> = {};
    if (impact !== undefined) metadata.impact = impact;
    if (priority !== undefined) metadata.priority = priority;

    await memory.updateGapMetadata(normalizedId, metadata);

    if (content !== undefined) {
      await memory.updateGapStatus(normalizedId, 'OPEN' as never);
      // Store refined content as a distilled memory for the planner to pick up
      await memory.updateDistilledMemory(
        `REFINED#GAP#${normalizedId}`,
        JSON.stringify({ originalGapId: normalizedId, refinedContent: content, refinedAt: Date.now() })
      );
    }
  }

  // If rejecting with reason, store as tactical lesson
  if (rejectionReason) {
    await memory.addLesson(
      `GAP_REFINEMENT#${normalizedId}`,
      `User rejected gap plan. Reason: ${rejectionReason}`,
      InsightCategory.TACTICAL_LESSON,
      0.9,
      8
    );
  }

  return { success: true, gapId: normalizedId };
});
