import {
  IMemory,
  IProvider,
  ITool,
  Message,
  ReasoningProfile,
  MessageRole,
  EventType,
  SSTResource,
} from './types/index';
import { ClawTracer } from './tracer';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';

const typedResource = Resource as unknown as SSTResource;

export class Agent {
  private eventbridge = new EventBridgeClient({});

  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string
  ) {}

  async process(
    userId: string,
    userText: string,
    profile: ReasoningProfile = ReasoningProfile.STANDARD
  ): Promise<string> {
    const tracer = new ClawTracer(userId);
    await tracer.startTrace({ userText });

    // 1. Get history, distilled facts, and tactical lessons
    const history = await this.memory.getHistory(userId);
    const distilled = await this.memory.getDistilledMemory(userId);
    const lessons = await this.memory.getLessons(userId);

    // 2. Check for recent Recovery Events (Dead Man's Switch)
    let recoveryContext = '';
    try {
      const recoveryData = await this.memory.getDistilledMemory('RECOVERY');
      if (recoveryData) {
        recoveryContext = `\n\nSYSTEM_RECOVERY_LOG: Recent emergency rollback occurred. Details: ${recoveryData}`;
        await this.memory.updateDistilledMemory('RECOVERY', '');
      }
    } catch (e) {
      console.error('Error checking recovery context:', e);
    }

    // 3. Add user message
    const userMessage: Message = { role: MessageRole.USER, content: userText };
    await this.memory.addMessage(userId, userMessage);

    // 4. Complete context (Smart Recall Index)
    let contextPrompt = this.systemPrompt;
    if (recoveryContext) contextPrompt += recoveryContext;

    const memoryIndex = `
      [MEMORY_INDEX]:
      - DISTILLED FACTS: ${distilled ? 'Available (load with recall_knowledge)' : 'None'}
      - TACTICAL LESSONS: ${lessons.length} recent available.
      
      USE 'recall_knowledge' to retrieve details if they are relevant to the user request.
    `;
    contextPrompt += `\n\n${memoryIndex}`;

    const messages: Message[] = [
      { role: MessageRole.SYSTEM, content: contextPrompt },
      ...history,
      userMessage,
    ];

    let responseText = '';
    let iterations = 0;
    const maxIterations = 5;

    try {
      while (iterations < maxIterations) {
        await tracer.addStep({ type: 'llm_call', content: { messageCount: messages.length } });
        const aiResponse = await this.provider.call(messages, this.tools, profile);

        if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
          messages.push(aiResponse);

          for (const toolCall of aiResponse.tool_calls) {
            const tool = this.tools.find((t) => t.name === toolCall.function.name);
            if (tool) {
              const args = JSON.parse(toolCall.function.arguments);
              await tracer.addStep({ type: 'tool_call', content: { tool: tool.name, args } });

              const result = await tool.execute(args);

              await tracer.addStep({ type: 'tool_result', content: { tool: tool.name, result } });

              messages.push({
                role: MessageRole.TOOL,
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: result,
              });
            }
          }
          iterations++;
        } else {
          responseText = aiResponse.content || '';
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await tracer.addStep({ type: 'error', content: { errorMessage } });
      responseText = `I encountered an internal error: ${errorMessage}`;
    }

    if (!responseText) responseText = 'Sorry, I reached my iteration limit.';

    // 5. Save response
    await this.memory.addMessage(userId, { role: MessageRole.ASSISTANT, content: responseText });

    // 6. Finalize Trace
    await tracer.endTrace(responseText);

    // 7. Trigger Reflection (async via EventBridge)
    try {
      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'main.agent',
              DetailType: EventType.REFLECT_TASK,
              Detail: JSON.stringify({
                userId,
                conversation: [...messages, { role: MessageRole.ASSISTANT, content: responseText }],
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
      console.log('Reflection task emitted for user:', userId);
    } catch (e) {
      console.error('Failed to emit reflection task:', e);
    }

    return responseText;
  }
}
