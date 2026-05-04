import { randomUUID } from 'node:crypto';
import { logger } from '../../lib/logger';
import { EventType, GapStatus, AGENT_TYPES } from '../../lib/types/agent';
import { InsightCategory, MemoryInsight } from '../../lib/types/memory';
import { emitEvent } from '../../lib/utils/bus';
import { normalizeGapId, getGapIdPK, getGapTimestamp } from '../../lib/memory/utils';
import type { ReflectionReport } from './schema';

/**
 * Processes a reflection report and updates the system state (memory, gaps, lessons).
 */
export async function processReflectionReport(
  parsed: ReflectionReport,
  memory: import('../../lib/types/memory').IMemory,
  userId: string,
  baseUserId: string,
  sessionId?: string,
  scope?: { workspaceId?: string }
): Promise<void> {
  // 1. Handle Facts
  const existingFacts = await memory.getDistilledMemory(baseUserId);
  if (parsed.facts && parsed.facts !== existingFacts) {
    await memory.updateDistilledMemory(baseUserId, parsed.facts);
    logger.info('Facts updated for user:', userId);
  }

  // 2. Handle Lessons
  if (Array.isArray(parsed.lessons)) {
    for (const lesson of parsed.lessons) {
      if (lesson.content && lesson.content !== 'NONE') {
        await memory.addLesson(baseUserId, lesson.content, {
          category: lesson.category || InsightCategory.TACTICAL_LESSON,
          confidence: lesson.confidence || 5,
          impact: lesson.impact || 5,
          complexity: lesson.complexity || 5,
          risk: lesson.risk || 5,
          urgency: lesson.urgency || 5,
          priority: lesson.priority || 5,
        });
        logger.info('Lesson saved with impact:', lesson.impact);
      }
    }
  }

  // 3. Handle Gaps
  if (Array.isArray(parsed.gaps)) {
    for (const gap of parsed.gaps) {
      if (gap.content && gap.content !== 'NONE') {
        const gapId = randomUUID();
        const metadata = {
          category: InsightCategory.STRATEGIC_GAP,
          confidence: gap.confidence || 5,
          impact: gap.impact || 5,
          complexity: gap.complexity || 5,
          risk: gap.risk || 5,
          urgency: gap.urgency || 5,
          priority: gap.priority || 5,
        };
        await memory.setGap(gapId, gap.content, metadata);
        logger.info('Strategic Gap saved with impact:', gap.impact);

        // Notify Planner Agent via EventBridge
        try {
          await emitEvent(AGENT_TYPES.COGNITION_REFLECTOR, EventType.EVOLUTION_PLAN, {
            gapId,
            details: gap.content,
            metadata,
            contextUserId: userId,
            sessionId,
          });
        } catch (e) {
          logger.error('Failed to emit evolution plan event from Reflector:', e);
        }
      }
    }
  }

  // 3b. Handle Updated Gaps (Deduplication)
  if (Array.isArray(parsed.updatedGaps)) {
    for (const uGap of parsed.updatedGaps) {
      if (uGap.id) {
        const normalizedId = normalizeGapId(uGap.id);
        const pk = getGapIdPK(normalizedId);
        const sk = getGapTimestamp(normalizedId);

        let existing: MemoryInsight | undefined = undefined;
        if (sk !== 0) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await (memory as any).base.queryItems({
              KeyConditionExpression: 'userId = :pk AND #ts = :ts',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':pk': pk, ':ts': sk },
            });
            if (items.length > 0) {
              existing = {
                id: items[0].userId,
                type: items[0].type || 'STRATEGIC_GAP',
                content: items[0].content,
                metadata: items[0].metadata || {},
                timestamp: items[0].timestamp,
              };
            }
          } catch (e) {
            logger.warn(`Direct gap lookup failed for ${normalizedId}, falling back to scan:`, e);
          }
        }

        if (!existing) {
          const allGaps = [
            ...(await memory.getAllGaps(GapStatus.OPEN, scope)),
            ...(await memory.getAllGaps(GapStatus.PLANNED, scope)),
          ];
          existing = allGaps.find((g: MemoryInsight) => normalizeGapId(g.id) === normalizedId);
        }

        if (existing) {
          const updatedMeta = {
            ...existing.metadata,
            impact: Math.max(existing.metadata.impact || 0, uGap.impact || 0),
            urgency: Math.max(existing.metadata.urgency || 0, uGap.urgency || 0),
          };
          await memory.updateGapMetadata(normalizedId, updatedMeta);
          logger.info(`Updated existing gap ${normalizedId} via semantic deduplication.`);
        }
      }
    }
  }

  // 4. Handle Resolved Gaps
  if (Array.isArray(parsed.resolvedGapIds)) {
    for (const rId of parsed.resolvedGapIds) {
      logger.info(`Verification successful for gap ${rId}. Marking as DONE.`);
      await memory.updateGapStatus(rId, GapStatus.DONE);
    }
  }
}
