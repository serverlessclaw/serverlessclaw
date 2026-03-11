import {
  IMemory,
  IProvider,
  ITool,
  Message,
  ReasoningProfile,
  MessageRole,
  EventType,
  IAgentConfig,
} from './types/index';
import { ClawTracer } from './tracer';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { logger } from './logger';
import { SSTResource } from './types/index';

const typedResource = Resource as unknown as SSTResource;

/**
 * The core Agent class responsible for orchestrating LLM calls, tool execution,
 * and memory management.
 */
export class Agent {
  private eventbridge: EventBridgeClient = new EventBridgeClient({});

  /**
   * Initializes a new Agent instance
   * @param memory - The memory provider for session history and distilled knowledge
   * @param provider - The LLM provider (OpenAI, Bedrock, etc.)
   * @param tools - The set of tools the agent is authorized to use
   * @param systemPrompt - The base personality and instruction set for the agent
   * @param config - Optional agent configuration (contains hot-swappable overrides)
   */
  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string,
    public config?: IAgentConfig
  ) {}

  /**
   * Processes a user message, potentially performing multiple tool-calling iterations
   * @param userId - Unique identifier for the user or session
   * @param userText - The raw input message from the user
   * @param profile - The reasoning profile (affects model choice and temperature)
   * @returns The final textual response from the agent
   */
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
      logger.error('Error checking recovery context:', e);
    }

    // 3. Add user message
    const userMessage: Message = { role: MessageRole.USER, content: userText };
    await this.memory.addMessage(userId, userMessage);

    // 2026 Hot-Swap Strategy: Resolve Model/Provider from DDB
    let activeModel: string | undefined = this.config?.model;
    const activeProvider: string | undefined = this.config?.provider;

    try {
      const { AgentRegistry } = await import('./registry');
      // If agent doesn't have a specific model, fallback to reasoning profile mapping
      if (!activeModel) {
        const profileMap = (await AgentRegistry.getRawConfig('reasoning_profiles')) as Record<
          string,
          string
        >;
        if (profileMap && profileMap[profile]) {
          activeModel = profileMap[profile];
        }
      }
    } catch {
      logger.warn('Failed to fetch reasoning_profiles from DDB, using hardcoded defaults.');
    }

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
    let maxIterations = 5;

    try {
      const { AgentRegistry } = await import('./registry');
      const customMax = await AgentRegistry.getRawConfig('max_tool_iterations');
      if (customMax !== undefined) {
        maxIterations = parseInt(String(customMax), 10);
      }
    } catch {
      logger.warn('Failed to fetch max_tool_iterations from DDB, using default 5.');
    }

    try {
      while (iterations < maxIterations) {
        await tracer.addStep({ type: 'llm_call', content: { messageCount: messages.length } });
        const aiResponse = await this.provider.call(
          messages,
          this.tools,
          profile,
          activeModel,
          activeProvider
        );

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
    // 2026 Optimization: Reflection frequency is now configurable.
    // Default is every 3 messages.
    let reflectionFrequency = 3;
    try {
      const { AgentRegistry } = await import('./registry');
      const customFreq = await AgentRegistry.getRawConfig('reflection_frequency');
      if (customFreq !== undefined) {
        reflectionFrequency = parseInt(String(customFreq), 10);
      }
    } catch {
      logger.warn('Failed to fetch reflection_frequency, using default 3.');
    }

    const shouldReflect =
      reflectionFrequency > 0 &&
      (history.length % reflectionFrequency === 0 ||
        userText.toLowerCase().includes('remember') ||
        userText.toLowerCase().includes('learn'));

    if (shouldReflect) {
      try {
        await this.eventbridge.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'main.agent',
                DetailType: EventType.REFLECT_TASK,
                Detail: JSON.stringify({
                  userId,
                  traceId: tracer.getTraceId(),
                  conversation: [
                    ...messages,
                    { role: MessageRole.ASSISTANT, content: responseText },
                  ],
                }),
                EventBusName: typedResource.AgentBus.name,
              },
            ],
          })
        );
        logger.info('Reflection task emitted for user:', userId);
      } catch (e) {
        logger.error('Failed to emit reflection task:', e);
      }
    }

    return responseText;
  }
}
