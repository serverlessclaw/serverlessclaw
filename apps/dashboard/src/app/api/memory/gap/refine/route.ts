/**
 * @module GapRefineAPI
 * Handles interactive gap refinement from the dashboard.
 * Supports editing description, priority, impact, associated plan, and rejection with reason.
 */
import { z } from 'zod';
import { withApiHandler, validateBody } from '@/lib/api-handler';
import { logger } from '@claw/core/lib/logger';

export const dynamic = 'force-dynamic';

const RefineGapSchema = z.object({
  gapId: z.string().min(1, 'gapId is required'),
  content: z.string().optional(),
  impact: z.number().min(1).max(10).optional(),
  priority: z.number().min(1).max(10).optional(),
  rejectionReason: z.string().optional(),
  plan: z.record(z.string(), z.unknown()).optional(), // Use record instead of any
});

export const POST = withApiHandler(async (body) => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const { InsightCategory } = await import('@claw/core/lib/types/memory');
  const { gapId, content, impact, priority, rejectionReason, plan } = validateBody(
    body,
    RefineGapSchema
  );

  const memory = new DynamoMemory();
  const normalizedId = gapId.replace(/^GAP#/, '');

  try {
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
          JSON.stringify({
            originalGapId: normalizedId,
            refinedContent: content,
            refinedAt: Date.now(),
          })
        );
      }
    }

    // Update associated plan if provided
    if (plan !== undefined) {
      // Plans are stored with PLAN#<numericId>
      await memory.updateDistilledMemory(`PLAN#${normalizedId}`, JSON.stringify(plan));
      logger.info(`Updated plan for gap ${normalizedId}`);
    }

    // If rejecting with reason, store as tactical lesson
    if (rejectionReason) {
      await memory.addLesson(
        `GAP_REFINEMENT#${normalizedId}`,
        `User rejected gap plan. Reason: ${rejectionReason}`,
        {
          category: InsightCategory.TACTICAL_LESSON,
          confidence: 0.9,
          impact: 8,
          complexity: 0,
          risk: 0,
          urgency: 5,
          priority: 8,
        }
      );
    }

    return { success: true, gapId: normalizedId };
  } catch (error) {
    logger.error(`Failed to refine gap ${normalizedId}:`, error);
    throw error;
  }
});
