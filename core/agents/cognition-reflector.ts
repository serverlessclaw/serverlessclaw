import {
  ReasoningProfile,
  Message,
  EventType,
  InsightCategory,
  GapStatus,
  AgentType,
  TraceSource,
} from '../lib/types/index';
import { LIMITS } from '../lib/constants';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  detectFailure,
  isTaskPaused,
  loadAgentConfig,
  extractBaseUserId,
  emitTaskEvent,
  getAgentContext,
} from '../lib/utils/agent-helpers';
import { emitEvent } from '../lib/utils/bus';

interface ReflectorPayload {
  userId: string;
  conversation: Message[];
  traceId?: string;
  sessionId?: string;
  task?: string;
  initiatorId?: string;
  depth?: number;
}

interface ReflectorEvent {
  detail?: ReflectorPayload;
  source?: string;
}

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
  const deployedGaps = await memory.getAllGaps(GapStatus.DEPLOYED);
  const activeGaps = [
    ...(await memory.getAllGaps(GapStatus.PLANNED)),
    ...(await memory.getAllGaps(GapStatus.PROGRESS)),
  ];

  const deployedGapsContext =
    deployedGaps.length > 0
      ? `\nRECENTLY DEPLOYED CHANGES (Audit required):
       ${deployedGaps.map((g) => `- [ID: ${g.id.replace('GAP#', '')}] ${g.content}`).join('\n')}
       
       TASK: Look at the CONVERSATION. If the user successfully used these new capabilities or if the conversation proves these gaps are now filled, include their IDs in "resolvedGapIds".`
      : '';

  const activeGapsContext =
    activeGaps.length > 0
      ? `\nGAPS ALREADY IN PROGRESS (Do not duplicate):
       ${activeGaps.map((g) => `- ${g.content}`).join('\n')}`
      : '';

  const reflectionPrompt = `
    EXISTING FACTS:
    ${existingFacts || 'None'}
 
    CONVERSATION:
    ${conversation.map((m: Message) => `${m.role.toUpperCase()}: ${m.content || (m.tool_calls ? '[Tool Calls]' : '')}`).join('\n')}
    ${traceContext}
    ${deployedGapsContext}
    ${activeGapsContext}
 
    Analyze the CONVERSATION and EXECUTION TRACE to extract intelligence and capability gaps.
    
    IMPORTANT - DEDUPLICATION:
    If you identify a gap that is semantically identical or very similar to one of the "GAPS ALREADY IN PROGRESS", do NOT create a new gap in the "gaps" array. Instead, add it to the "updatedGaps" array with its existing ID and potentially increased impact/urgency.
    
    You MUST return your response as a valid JSON object with the following schema:
    {
      "facts": "string (the updated complete list of all known facts about the user and project context)",
      "lessons": [
        { "content": "string (actionable technical lesson)", "category": "tactical_lesson", "impact": 1-10 }
      ],
      "gaps": [
        { "content": "string (missing tool or architectural limitation)", "impact": 1-10, "urgency": 1-10 }
      ],
      "updatedGaps": [
        { "id": "string (existing gap ID)", "impact": 1-10, "urgency": 1-10 }
      ],
      "resolvedGapIds": ["string (IDs of gaps that were successfully addressed in this conversation)"]
    }
  `;

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
    }
  );

  const isFailure = detectFailure(response);

  if (response && !isFailure) {
    try {
      // Clean potential markdown formatting from JSON
      const jsonContent = response.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonContent);

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
            const gapId = Date.now().toString() + '-' + Math.floor(Math.random() * 1000); // ensure uniqueness
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
              await emitEvent('reflector.agent', EventType.EVOLUTION_PLAN, {
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
            const cleanId = uGap.id.replace('GAP#', '');
            // Retrieve existing to update metadata
            const allGaps = [
              ...(await memory.getAllGaps(GapStatus.OPEN)),
              ...(await memory.getAllGaps(GapStatus.PLANNED)),
            ];
            const existing = allGaps.find((g) => g.id === `GAP#${cleanId}`);
            if (existing) {
              const updatedMeta = {
                ...existing.metadata,
                impact: Math.max(existing.metadata.impact || 0, uGap.impact || 0),
                urgency: Math.max(existing.metadata.urgency || 0, uGap.urgency || 0),
              };
              await memory.setGap(cleanId, existing.content, updatedMeta);
              logger.info(`Updated existing gap ${cleanId} via semantic deduplication.`);
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
      source: 'reflector.agent',
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
