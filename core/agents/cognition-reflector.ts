import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import {
  ReasoningProfile,
  Message,
  EventType,
  SSTResource,
  InsightCategory,
  GapStatus,
  AgentType,
  TraceSource,
} from '../lib/types/index';
import { Resource } from 'sst';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';

const typedResource = Resource as unknown as SSTResource;

const memory = new DynamoMemory();
const provider = new ProviderManager();
const eventbridge = new EventBridgeClient({});

export const REFLECTOR_SYSTEM_PROMPT = `
You are the Cognition Reflector for Serverless Claw. Your role is to audit system performance, extract intelligence from interactions, and identify capability gaps.

Key Obligations:
1. **Fact Extraction**: Update 'EXISTING FACTS' with new user preferences, project context, or system state changes discovered in the conversation.
2. **Gap Identification**: Identify 'NEW CAPABILITY GAPS'. Look for high-level user frustrations, "I can't do that" moments, or mechanical failures (errors) in the 'EXECUTION TRACE'.
3. **Tactical Lessons**: Extract reusable technical patterns, 'gotchas', or project-specific rules into tactical memory.
4. **Trace Analysis**: Deeply analyze the 'EXECUTION TRACE' (tool calls and results) to identify where agents might be hallucinating tool results or failing to use the right tools.
5. **Verification Audit**: Review conversation history to see if 'DEPLOYED' gaps have been successfully resolved in the real world.
6. **Direct Communication**: Use 'sendMessage' to notify the human user immediately of any critical facts or lessons learned.
7. **Output Format**: You MUST respond in valid JSON format as specified in your handler logic.
`;

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
  const payload = event.detail || (event as unknown as ReflectorPayload);
  const { userId, conversation, traceId, sessionId } = payload;

  if (!userId || !conversation) {
    logger.warn('Reflector received incomplete payload, skipping audit.', {
      hasUserId: !!userId,
      hasConversation: !!conversation,
      source: event.source,
    });
    return;
  }

  // 1. Fetch Execution Trace (Deeper detail than conversation)
  let traceContext = '';
  if (traceId) {
    try {
      const { ClawTracer } = await import('../lib/tracer');
      const trace = await ClawTracer.getTrace(traceId);

      // Safety: Only analyze user-facing interactions (Dashboard/Telegram)
      // Ignore system-initiated traces (like previous reflector runs) to prevent self-audit loops.
      if (trace && trace.source !== TraceSource.SYSTEM && trace.steps) {
        let fullTrace = trace.steps
          .map((s) => `[${s.type.toUpperCase()}] ${JSON.stringify(s.content)}`)
          .join('\n');

        // Truncate trace if it's too large to prevent LLM/DDB issues
        if (fullTrace.length > 5000) {
          fullTrace = fullTrace.substring(0, 5000) + '\n... [TRACE_TRUNCATED]';
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
  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(AgentType.COGNITION_REFLECTOR);
  if (!config) {
    logger.error('Failed to load Reflector configuration');
    return;
  }

  const agentTools = await (await import('../tools/index')).getAgentTools('cognition-reflector');
  const reflector = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  // 2. Handle simple direct tasks (e.g. greetings)
  if (payload.task) {
    const taskLower = payload.task.toLowerCase();
    if (taskLower.includes('greet') || taskLower.includes('hi') || taskLower.includes('hello')) {
      return await reflector.process(userId, payload.task, {
        profile: ReasoningProfile.FAST,
        isIsolated: true,
        traceId,
        sessionId,
        source: TraceSource.SYSTEM,
      });
    }
  }

  const existingFacts = await memory.getDistilledMemory(userId);
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
    ${conversation.map((m) => `${m.role.toUpperCase()}: ${m.content || (m.tool_calls ? '[Tool Calls]' : '')}`).join('\n')}
    ${traceContext}
    ${deployedGapsContext}
    ${activeGapsContext}

    Update the EXISTING FACTS with any new information found in the CONVERSATION or EXECUTION TRACE.
    Identify any NEW CAPABILITY GAPS (errors in trace, missing tools, or user frustrations).
  `;

  // Use 'fast' profile for cost-effective reflection
  const response = await reflector.process(userId, reflectionPrompt, {
    profile: ReasoningProfile.FAST,
    isIsolated: true,
    source: TraceSource.SYSTEM,
  });

  if (response) {
    try {
      // Clean potential markdown formatting from JSON
      const jsonContent = response.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonContent);

      // 1. Handle Facts
      if (parsed.facts && parsed.facts !== existingFacts) {
        await memory.updateDistilledMemory(userId, parsed.facts);
        logger.info('Facts updated for user:', userId);
      }

      // 2. Handle Lessons
      if (Array.isArray(parsed.lessons)) {
        for (const lesson of parsed.lessons) {
          if (lesson.content && lesson.content !== 'NONE') {
            await memory.addLesson(userId, lesson.content, {
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
            const gapId = Date.now().toString();
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
              await eventbridge.send(
                new PutEventsCommand({
                  Entries: [
                    {
                      Source: 'reflector.agent',
                      DetailType: EventType.EVOLUTION_PLAN,
                      Detail: JSON.stringify({
                        gapId,
                        details: gap.content,
                        metadata,
                        contextUserId: userId,
                      }),
                      EventBusName: typedResource.AgentBus.name,
                    },
                  ],
                })
              );
            } catch (e) {
              logger.error('Failed to emit evolution plan event from Reflector:', e);
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
  try {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({});
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'reflector.agent',
            DetailType: EventType.TASK_COMPLETED,
            Detail: JSON.stringify({
              userId,
              agentId: AgentType.COGNITION_REFLECTOR,
              task: 'Session Reflection',
              response: response || 'No insights extracted.',
              traceId,
              initiatorId: payload.initiatorId,
              depth: payload.depth,
              sessionId,
            }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    logger.error('Failed to emit TASK_COMPLETED from Reflector:', e);
  }

  return response;
};
