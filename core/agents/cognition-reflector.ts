import { ReasoningProfile, ResponseFormat } from '../lib/types/llm';
import { EventType, GapStatus, AgentType, TraceSource } from '../lib/types/agent';
import { InsightCategory, MemoryInsight } from '../lib/types/memory';
import { LIMITS } from '../lib/constants';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import {
  extractPayload,
  detectFailure,
  isTaskPaused,
  loadAgentConfig,
  extractBaseUserId,
  getAgentContext,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { normalizeGapId, getGapIdPK, getGapTimestamp } from '../lib/memory/utils';
import { emitEvent } from '../lib/utils/bus';
import { buildReflectionPrompt, getGapContext } from './cognition-reflector/prompts';
import type { ReflectorEvent } from './cognition-reflector/types';
import { ReflectionReportSchema, type ReflectionReport } from './cognition-reflector/schema';

/**
 * Reflector Agent handler. Analyzes conversations to extract facts, lessons, and capability gaps.
 *
 * @param event - The event containing userId and the conversation history.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the reflection report string, or undefined on error.
 */
export const handler = async (
  event: ReflectorEvent,
  _context: Context
): Promise<string | undefined> => {
  logger.info('Reflector Agent received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<ReflectorEvent>(event);
  const { userId, conversation, traceId, sessionId, task, initiatorId, depth } =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload.detail || (payload as any); // Double safety for direct or wrapped event

  if (!userId || !conversation) {
    logger.warn('Reflector received incomplete payload, skipping audit.', {
      hasUserId: !!userId,
      hasConversation: !!conversation,
      source: event.source,
    });
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // 1. Fetch Execution Trace (Deeper detail than conversation)
  let traceContext = '';
  if (traceId) {
    try {
      const { ClawTracer } = await import('../lib/tracer');
      const traceNodes = await ClawTracer.getTrace(traceId);
      const trace = traceNodes[0]; // Primary node

      // Safety: Only analyze user-facing interactions (Dashboard/Telegram)
      // Ignore system-initiated traces (like previous reflector runs) to prevent self-audit loops.
      if (trace && trace.source !== TraceSource.SYSTEM && trace.steps) {
        let fullTrace = trace.steps
          .map((s) => `[${s.type.toUpperCase()}] ${JSON.stringify(s.content)}`)
          .join('\n');

        // Truncate trace if it's too large to prevent LLM/DDB issues
        if (fullTrace.length > LIMITS.TRACE_TRUNCATE_LENGTH) {
          fullTrace =
            fullTrace.substring(0, LIMITS.TRACE_TRUNCATE_LENGTH) + '\n... [TRACE_TRUNCATED]';
        }

        traceContext = `\nEXECUTION TRACE (Mechanical Steps):\n${fullTrace}\n`;
      } else if (trace?.source === TraceSource.SYSTEM) {
        logger.info('Reflector skipping system-initiated trace audit.');
      }
    } catch (e) {
      logger.warn('Failed to fetch trace for Reflector:', e);
    }
  }

  // Reflector Agent is a specialized Agent instance
  const config = await loadAgentConfig(AgentType.COGNITION_REFLECTOR);
  const { memory, provider: providerManager } = await getAgentContext();

  const agentTools = await (await import('../tools/index')).getAgentTools('cognition-reflector');
  const { Agent } = await import('../lib/agent');
  const reflector = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);

  // 2. Handle simple direct tasks (e.g. greetings)
  if (task) {
    const taskLower = task.toLowerCase();
    if (taskLower.includes('greet') || taskLower.includes('hi') || taskLower.includes('hello')) {
      const { responseText } = await reflector.process(userId, task, {
        profile: ReasoningProfile.FAST,
        isIsolated: true,
        traceId,
        sessionId,
        source: TraceSource.SYSTEM,
      });
      return responseText;
    }
  }

  const existingFacts = await memory.getDistilledMemory(baseUserId);
  const failurePatterns = await memory.getFailurePatterns(baseUserId, '*', 5);

  // Get gap context
  const { deployedGaps, activeGaps } = await getGapContext(memory);

  const reflectionPrompt = await buildReflectionPrompt(
    memory,
    baseUserId,
    conversation,
    traceContext,
    deployedGaps,
    activeGaps,
    failurePatterns
  );

  // Use 'standard' profile for reflection — FAST was too shallow for reliable gap closure detection
  // and produced false-positive "resolved" signals from vague user messages.
  const { responseText: response, attachments: resultAttachments } = await reflector.process(
    baseUserId,
    reflectionPrompt,
    {
      profile: ReasoningProfile.STANDARD,
      isIsolated: true,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
      communicationMode: 'json',
      responseFormat: ReflectionReportSchema as ResponseFormat,
    }
  );

  const isFailure = detectFailure(response);

  if (response && !isFailure) {
    try {
      const parsed = parseStructuredResponse<ReflectionReport>(response);

      // 1. Handle Facts
      if (parsed.facts && parsed.facts !== existingFacts) {
        await memory.updateDistilledMemory(baseUserId, parsed.facts);
        logger.info('Facts updated for user:', baseUserId);
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
              await emitEvent(AgentType.COGNITION_REFLECTOR, EventType.EVOLUTION_PLAN, {
                gapId,
                details: gap.content,
                metadata,
                contextUserId: userId,
                sessionId, // Propagate session context for history syncing
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

            // Targeted lookup instead of scanning all gaps (P1-7 Optimization)
            let existing: MemoryInsight | undefined = undefined;
            if (sk > 0) {
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
                    timestamp: items[0].timestamp,
                    content: items[0].content,
                    metadata: items[0].metadata || {},
                  };
                }
              } catch (e) {
                logger.warn(
                  `Direct gap lookup failed for ${normalizedId}, falling back to scan:`,
                  e
                );
              }
            }

            // Fallback to broader search if direct lookup failed or ID was non-numeric
            if (!existing) {
              const allGaps = [
                ...(await memory.getAllGaps(GapStatus.OPEN)),
                ...(await memory.getAllGaps(GapStatus.PLANNED)),
              ];
              existing = allGaps.find((g: any) => normalizeGapId(g.id) === normalizedId);
            }

            if (existing) {
              const updatedMeta = {
                ...existing.metadata,
                impact: Math.max(existing.metadata.impact || 0, uGap.impact || 0),
                urgency: Math.max(existing.metadata.urgency || 0, uGap.urgency || 0),
              };
              // Use updateGapMetadata to preserve existing status (avoids resetting to OPEN)
              await memory.updateGapMetadata(normalizedId, updatedMeta);
              logger.info(`Updated existing gap ${normalizedId} via semantic deduplication.`);
            }
          }
        }
      }

      // 4. Handle Resolved Gaps (Audit)
      if (Array.isArray(parsed.resolvedGapIds)) {
        for (const rId of parsed.resolvedGapIds) {
          logger.info(`Verification successful for gap ${rId}. Marking as DONE.`);
          await memory.updateGapStatus(rId, GapStatus.DONE);
        }
      }
    } catch (e) {
      logger.error('Failed to parse Reflector JSON response:', e);
      logger.info('Raw response was:', response);
    }
  }

  // Universal Coordination: Notify Initiator (if any)
  if (!isTaskPaused(response)) {
    await emitTaskEvent({
      source: AgentType.COGNITION_REFLECTOR,
      agentId: AgentType.COGNITION_REFLECTOR,
      userId,
      task: task || 'Session Reflection',
      response: response || 'No insights extracted.',
      attachments: resultAttachments,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });
  }

  return response;
};
