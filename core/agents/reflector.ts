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
} from '../lib/types/index';
import { Resource } from 'sst';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../lib/logger';

const typedResource = Resource as unknown as SSTResource;

const memory = new DynamoMemory();
const provider = new ProviderManager();
const eventbridge = new EventBridgeClient({});

export const handler = async (event: { userId: string; conversation: Message[] }) => {
  logger.info('Reflector Agent received task:', JSON.stringify(event, null, 2));

  const { userId, conversation } = event;

  if (!userId || !conversation) {
    logger.error('Invalid event payload');
    return;
  }

  // Reflector Agent is a specialized Agent instance
  const reflector = new Agent(
    memory,
    provider,
    [], // No tools needed for reflection
    `You are the specialized Reflector Agent for the Serverless Claw stack.
     Your goal is to analyze conversations and extract insights.

     1. EXTRACT FACTS: Identify permanent user details for long-term memory.
     2. IDENTIFY GAPS: Analyze if the agent's response was lacking or if the system is missing a capability.
     3. ESTIMATE SIGNALS: For each lesson or gap, estimate:
        - Confidence (1-10): Certainty of the observation.
        - Impact (1-10): Value added / friction removed.
        - Complexity (1-10): Effort to implement/fix.
        - Risk (1-10): Danger of regression.
        - Urgency (1-10): Time-sensitivity.
     4. CATEGORIZE: Use categories: 'user_preference', 'tactical_lesson', 'strategic_gap', 'system_knowledge'.

     RETURN FORMAT (STRICT JSON):
     {
       "facts": "updated facts string",
       "lessons": [...],
       "gaps": [...],
       "resolvedGapIds": ["gapId1", "gapId2"]
     }
     
     Keep "facts" as a single cohesive string representing all available knowledge about the user.`
  );

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
    ${deployedGapsContext}
    ${activeGapsContext}

    Update the EXISTING FACTS with any new information found in the CONVERSATION.
    Identify any NEW CAPABILITY GAPS (that are not already listed as in progress).
  `;

  // Use 'fast' profile for cost-effective reflection
  const response = await reflector.process(
    `SYSTEM#REFLECTOR#${userId}`,
    reflectionPrompt,
    ReasoningProfile.FAST
  );

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

  return response;
};
