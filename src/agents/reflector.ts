import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers';
import { ReasoningProfile, Message, EventType, SSTResource, InsightCategory } from '../lib/types';
import { Resource } from 'sst';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const typedResource = Resource as unknown as SSTResource;

const memory = new DynamoMemory();
const provider = new ProviderManager();
const eventbridge = new EventBridgeClient({});

export const handler = async (event: { userId: string; conversation: Message[] }) => {
  console.log('Reflector Agent received task:', JSON.stringify(event, null, 2));

  const { userId, conversation } = event;

  if (!userId || !conversation) {
    console.error('Invalid event payload');
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
     3. ESTIMATE ROI & PRIORITY: For each lesson or gap, estimate the Return on Investment (ROI) and Priority (1-10).
     4. CATEGORIZE: Use categories: 'user_preference', 'tactical_lesson', 'strategic_gap', 'system_knowledge'.

     RETURN FORMAT (STRICT JSON):
     {
       "facts": "updated facts string",
       "lessons": [
         { "content": "lesson content", "roi": number, "priority": number, "category": "user_preference" | "tactical_lesson" }
       ],
       "gaps": [
         { "content": "gap description", "roi": number, "priority": number, "category": "strategic_gap" }
       ]
     }
     
     Keep "facts" as a single cohesive string representing all available knowledge about the user.`
  );

  const existingFacts = await memory.getDistilledMemory(userId);

  const reflectionPrompt = `
    EXISTING FACTS:
    ${existingFacts || 'None'}

    CONVERSATION:
    ${conversation.map((m) => `${m.role.toUpperCase()}: ${m.content || (m.tool_calls ? '[Tool Calls]' : '')}`).join('\n')}

    Update the EXISTING FACTS with any new information found in the CONVERSATION.
    Identify any CAPABILITY GAPS.
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
        console.log('Facts updated for user:', userId);
      }

      // 2. Handle Lessons
      if (Array.isArray(parsed.lessons)) {
        for (const lesson of parsed.lessons) {
          if (lesson.content && lesson.content !== 'NONE') {
            await memory.addLesson(userId, lesson.content, {
              category: lesson.category || InsightCategory.TACTICAL_LESSON,
              estimatedROI: lesson.roi || 0,
              priority: lesson.priority || 0,
            });
            console.log('Lesson saved with ROI:', lesson.roi);
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
              estimatedROI: gap.roi || 0,
              priority: gap.priority || 0,
            };
            await memory.setGap(gapId, gap.content, metadata);
            console.log('Strategic Gap saved with ROI:', gap.roi);

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
              console.error('Failed to emit evolution plan event from Reflector:', e);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse Reflector JSON response:', e);
      console.log('Raw response was:', response);
    }
  }

  return response;
};
