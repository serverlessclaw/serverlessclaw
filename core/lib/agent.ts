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
import { Context as LambdaContext } from 'aws-lambda';
import { SYSTEM } from './constants';

const typedResource = Resource as unknown as SSTResource;

const AGENT_DEFAULTS = {
  MAX_ITERATIONS: 15,
  REFLECTION_FREQUENCY: 3,
  TIMEOUT_BUFFER_MS: 30000, // 30 seconds
} as const;

const AGENT_LOG_MESSAGES = {
  TIMEOUT_APPROACHING: 'Lambda timeout approaching, pausing task...',
  RECOVERY_LOG_PREFIX: '\n\nSYSTEM_RECOVERY_LOG: Recent emergency rollback occurred. Details: ',
  TASK_PAUSED_TIMEOUT:
    'TASK_PAUSED: I need more time to complete this. I have checkpointed my progress and am resuming in a fresh execution...',
  TASK_PAUSED_ITERATION_LIMIT:
    'TASK_PAUSED: This task is complex and requires multiple steps. I have reached my single-turn safety limit and am resuming in a fresh execution...',
} as const;

/**
 * Processing options for the agent's process method.
 */
export interface AgentProcessOptions {
  /**
   * The reasoning profile to use for the LLM call.
   * @default ReasoningProfile.STANDARD
   */
  profile?: ReasoningProfile;
  /**
   * The AWS Lambda context for timeout monitoring.
   */
  context?: LambdaContext;
  /**
   * Whether this is a continuation of a previously paused task.
   * @default false
   */
  isContinuation?: boolean;
  /**
   * Whether to work in a private memory namespace: <AGENT_ID>#<userId>#<traceId>
   * @default false
   */
  isIsolated?: boolean;
  /**
   * The agent ID that initiated this task.
   */
  initiatorId?: string;
  /**
   * The current recursion depth.
   */
  depth?: number;
  /**
   * The current trace identifier (for linking executions).
   */
  traceId?: string;
  /**
   * The current dashboard session ID (if applicable).
   */
  sessionId?: string;
  /**
   * The origin of the request (e.g., 'dashboard', 'telegram', 'system').
   * @default 'unknown'
   */
  source?: string;
}

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
   * @param options - Configuration for this process run
   * @returns A promise that resolves to the final textual response from the agent
   */
  async process(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): Promise<string> {
    const {
      profile = ReasoningProfile.STANDARD,
      context,
      isContinuation = false,
      isIsolated = false,
      initiatorId,
      depth = 0,
      traceId: incomingTraceId,
      sessionId,
      source = 'unknown',
    } = options;

    // Extract base userId for tool context and tracing (remove CONV# prefix if present)
    const baseUserId = userId.startsWith('CONV#') ? userId.split('#')[1] : userId;

    const tracer = new ClawTracer(baseUserId, source, incomingTraceId);
    const traceId = tracer.getTraceId();

    const currentInitiator = initiatorId || this.config?.id || 'unknown';

    // For outbound messages, we need the original full userId (which might be CONV#...)
    const mainConversationId = userId;

    if (!isContinuation) {
      await tracer.startTrace({ userText, sessionId });
    }

    // Determine storage identifier (Namespaced if isolated)
    const agentId = this.config?.id || 'unknown';
    const storageId = isIsolated ? `${agentId.toUpperCase()}#${userId}#${traceId}` : userId;

    if (isIsolated) {
      logger.info(`Using isolated memory namespace: ${storageId}`);
    }

    // 1. Get history, distilled facts, and tactical lessons
    const history = await this.memory.getHistory(storageId);
    const distilled = await this.memory.getDistilledMemory(userId);
    const lessons = await this.memory.getLessons(userId);

    // 2. Check for recent Recovery Events (Dead Man's Switch)
    let recoveryContext = '';
    try {
      const recoveryData = await this.memory.getDistilledMemory(SYSTEM.RECOVERY_KEY || 'RECOVERY');
      if (recoveryData) {
        recoveryContext = `${AGENT_LOG_MESSAGES.RECOVERY_LOG_PREFIX}${recoveryData}`;
        await this.memory.updateDistilledMemory(SYSTEM.RECOVERY_KEY || 'RECOVERY', '');
      }
    } catch (e) {
      logger.error('Error checking recovery context:', e);
    }

    // 3. Add user message (Skip if continuation as it's already in history)
    const userMessage: Message = { role: MessageRole.USER, content: userText };
    if (!isContinuation) {
      await this.memory.addMessage(storageId, userMessage);
    }

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
      - DISTILLED FACTS: ${distilled ? 'Available (load with recallKnowledge)' : 'None'}
      - TACTICAL LESSONS: ${lessons.length} recent available.
      
      USE 'recallKnowledge' to retrieve details if they are relevant to the user request.
    `;
    contextPrompt += `\n\n${memoryIndex}`;

    const messages: Message[] = [
      { role: MessageRole.SYSTEM, content: contextPrompt },
      ...history,
      userMessage,
    ];

    let responseText = '';
    let iterations = 0;
    let maxIterations = this.config?.maxIterations || AGENT_DEFAULTS.MAX_ITERATIONS;

    try {
      const { AgentRegistry } = await import('./registry');
      const customMax = await AgentRegistry.getRawConfig('max_tool_iterations');
      if (customMax !== undefined) {
        maxIterations = parseInt(String(customMax), 10);
      }
    } catch {
      logger.warn(`Failed to fetch max_tool_iterations from DDB, using default ${maxIterations}.`);
    }

    try {
      while (iterations < maxIterations) {
        // Pause/Resume Logic: Check for Lambda Timeout
        if (context) {
          const remainingTime = context.getRemainingTimeInMillis();
          if (remainingTime < AGENT_DEFAULTS.TIMEOUT_BUFFER_MS) {
            logger.info(AGENT_LOG_MESSAGES.TIMEOUT_APPROACHING, {
              remainingTime,
              iterations,
            });

            const pauseMsg = AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT;

            // Save pause message to memory so it doesn't disappear on refresh
            await this.memory.addMessage(storageId, {
              role: MessageRole.ASSISTANT,
              content: pauseMsg,
              agentName: this.config?.name || 'SuperClaw',
              traceId,
            });

            await this.emitContinuation(userId, userText, tracer.getTraceId(), {
              initiatorId: currentInitiator,
              depth,
              sessionId,
            });
            return pauseMsg;
          }
        }

        await tracer.addStep({
          type: 'llm_call',
          content: {
            messageCount: messages.length,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          },
        });
        const aiResponse = await this.provider.call(
          messages,
          this.tools,
          profile,
          activeModel,
          activeProvider
        );

        await tracer.addStep({
          type: 'llm_response',
          content: {
            content: aiResponse.content,
            tool_calls: aiResponse.tool_calls,
          },
        });

        if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
          messages.push(aiResponse);

          for (const toolCall of aiResponse.tool_calls) {
            const tool = this.tools.find((t) => t.name === toolCall.function.name);
            if (tool) {
              const args = JSON.parse(toolCall.function.arguments);
              // Inject traceId for propagation and peeking
              if (args && typeof args === 'object') {
                args.traceId = traceId;
                args.initiatorId = currentInitiator;
                args.depth = depth;
                args.sessionId = sessionId;
                args.userId = args.userId || baseUserId;
                args.mainConversationId = mainConversationId;
              }
              await tracer.addStep({
                type: 'tool_call',
                content: { toolName: tool.name, args: args },
              });

              const result = await tool.execute(args);

              await tracer.addStep({
                type: 'tool_result',
                content: { toolName: tool.name, result: result },
              });

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

    if (!responseText) {
      if (iterations >= maxIterations) {
        logger.info('Iteration limit reached, pausing task...', { iterations });

        const pauseMsg = AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT;

        // Save pause message to memory so it doesn't disappear on refresh
        await this.memory.addMessage(storageId, {
          role: MessageRole.ASSISTANT,
          content: pauseMsg,
          agentName: this.config?.name || 'SuperClaw',
          traceId,
        });

        await this.emitContinuation(userId, userText, tracer.getTraceId(), {
          initiatorId: currentInitiator,
          depth,
          sessionId,
        });
        return pauseMsg;
      }
      responseText = 'Sorry, I reached my iteration limit.';
    }

    // 5. Save response
    await this.memory.addMessage(storageId, {
      role: MessageRole.ASSISTANT,
      content: responseText,
      agentName: this.config?.name || 'SuperClaw',
      traceId, // Link this message to its mechanical trace
    });

    // 6. Finalize Trace
    await tracer.endTrace(responseText);

    // 7. Trigger Reflection (async via EventBridge)
    // 2026 Optimization: Reflection frequency is now configurable.
    let reflectionFrequency: number = AGENT_DEFAULTS.REFLECTION_FREQUENCY;
    try {
      const { AgentRegistry } = await import('./registry');
      const customFreq = await AgentRegistry.getRawConfig('reflection_frequency');
      if (customFreq !== undefined) {
        reflectionFrequency = parseInt(String(customFreq), 10);
      }
    } catch {
      logger.warn(`Failed to fetch reflection_frequency, using default ${reflectionFrequency}.`);
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
                  sessionId,
                  conversation: [
                    ...messages,
                    {
                      role: MessageRole.ASSISTANT,
                      content: responseText,
                      agentName: this.config?.name,
                      traceId,
                    },
                  ],
                  initiatorId: currentInitiator,
                  depth,
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

  /**
   * Emits an event to trigger a continuation of the current task
   * @param userId - Unique identifier for the user or session
   * @param task - The raw input message or task description
   * @param traceId - The trace identifier for linking continued executions
   * @param metadata - Routing metadata (initiatorId, depth, sessionId)
   */
  private async emitContinuation(
    userId: string,
    task: string,
    traceId: string,
    metadata: { initiatorId?: string; depth?: number; sessionId?: string } = {}
  ): Promise<void> {
    try {
      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: this.config?.id || 'main.agent',
              DetailType: EventType.CONTINUATION_TASK,
              Detail: JSON.stringify({
                userId,
                task,
                isContinuation: true,
                traceId,
                initiatorId: metadata.initiatorId,
                depth: metadata.depth,
                sessionId: metadata.sessionId,
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
      logger.info('Continuation task emitted for user:', userId);
    } catch (e) {
      logger.error('Failed to emit continuation task:', e);
    }
  }
}
