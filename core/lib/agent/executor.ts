import { Message, ITool, IProvider, ReasoningProfile, MessageRole, ToolCall } from '../types/index';
import { logger } from '../logger';
import { normalizeProfile } from '../providers/utils';
import { ClawTracer } from '../tracer';
import { LIMITS, TRACE_TYPES } from '../constants';
import { ContextManager } from './context-manager';
import { Context as LambdaContext } from 'aws-lambda';
import { AGENT_DEFAULTS, AGENT_LOG_MESSAGES, LoopResult, ExecutorUsage } from './executor-types';
export { AGENT_DEFAULTS, AGENT_LOG_MESSAGES };
import { ExecutorHelper } from './executor-helper';
import { ToolExecutor } from './tool-executor';

/**
 * Core identity fields that MUST be provided by the caller.
 * These are resolved upstream in Agent.process() before reaching the executor.
 */
export interface ExecutorCoreOptions {
  /** The LLM model ID (e.g., 'gpt-5.4'). Must be resolved before calling executor. */
  activeModel: string;
  /** The LLM provider name (e.g., 'openai'). Must be resolved before calling executor. */
  activeProvider: string;
  /** The reasoning profile controlling depth/cost tradeoff. */
  activeProfile: ReasoningProfile;
  /** Maximum tool-call iterations allowed. */
  maxIterations: number;
  /** Tracer for observability. */
  tracer: ClawTracer;
  /** Global trace ID for DAG correlation. */
  traceId: string;
  /** Unique task ID for cancellation checks. */
  taskId: string;
  /** Current node ID in the trace DAG. */
  nodeId: string;
  /** The agent that initiated this task (for result routing). */
  currentInitiator: string;
  /** Current recursion depth for loop protection. */
  depth: number;
  /** The user who owns this conversation. */
  userId: string;
  /** The raw user text that triggered this execution. */
  userText: string;
  /** The main conversation storage ID. */
  mainConversationId: string;
}

/**
 * Optional feature fields that enhance execution behavior.
 * These have sensible defaults or are only needed for specific scenarios.
 */
export interface ExecutorFeatureOptions {
  /** Lambda execution context for timeout checks. */
  context?: LambdaContext;
  /** Parent node ID in the trace DAG. */
  parentId?: string;
  /** Session ID for pending message injection and IoT streaming. */
  sessionId?: string;
  /** Response format for structured output. */
  responseFormat?: import('../types/index').ResponseFormat;
  /** Task timeout in milliseconds. */
  taskTimeoutMs?: number;
  /** Behavior when timeout is reached. */
  timeoutBehavior?: 'pause' | 'fail' | 'continue';
  /** Session state manager for concurrent message handling. */
  sessionStateManager?: import('../session-state').SessionStateManager;
  /** List of approved tool call IDs (for HITL). */
  approvedToolCalls?: string[];
  /** Whether this is a continuation of a previously paused task. */
  isContinuation?: boolean;
  /** Communication mode: 'text' for human, 'json' for agent-to-agent. */
  communicationMode?: 'text' | 'json';
  /** Emitter for real-time streaming to dashboard. */
  emitter?: import('./emitter').AgentEmitter;
}

/** Combined executor options: core (required) + features (optional). */
export type ExecutorOptions = ExecutorCoreOptions & ExecutorFeatureOptions;

/**
 * Validates that all required executor options are present.
 * Throws with a clear error message if critical fields are missing.
 * This prevents silent fallbacks from masking upstream configuration bugs.
 */
export function validateExecutorOptions(options: ExecutorOptions): void {
  const required: (keyof ExecutorCoreOptions)[] = [
    'activeModel',
    'activeProvider',
    'activeProfile',
    'maxIterations',
    'tracer',
    'traceId',
    'taskId',
    'nodeId',
    'currentInitiator',
    'depth',
    'userId',
    'userText',
    'mainConversationId',
  ];

  const missing = required.filter(
    (key) => options[key] === undefined || options[key] === null || options[key] === ''
  );

  if (missing.length > 0) {
    throw new Error(
      `ExecutorOptions missing required fields: ${missing.join(', ')}. ` +
        `Ensure Agent.process() resolves these before passing to AgentExecutor.`
    );
  }
}

/**
 * Handles the iterative execution loop of an agent.
 */
export class AgentExecutor {
  private lastInjectedMessageTimestamp: number = Date.now();

  constructor(
    private provider: IProvider,
    private tools: ITool[],
    private agentId: string,
    private agentName: string,
    private systemPrompt: string = '',
    private summary: string | null = null,
    private contextLimit: number = LIMITS.MAX_CONTEXT_LENGTH
  ) {}

  async runLoop(messages: Message[], options: ExecutorOptions): Promise<LoopResult> {
    // Structural enforcement: validate required fields at boundary
    validateExecutorOptions(options);

    const { maxIterations, tracer, approvedToolCalls } = options;

    let iterations = 0;
    let responseText = '';
    const attachments: NonNullable<Message['attachments']> = [];
    let lastAiResponse: Message | undefined;
    const usage: ExecutorUsage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      toolCallCount: 0,
      durationMs: 0,
    };
    const loopStartTime = Date.now();

    while (iterations < maxIterations) {
      const errorResult = await this.performPreLoopChecks(messages, attachments, options);
      if (errorResult) return { ...errorResult, attachments };

      const aiResponse = await this.callLLM(messages, options);
      lastAiResponse = aiResponse;
      this.updateUsage(usage, aiResponse, options.activeProvider);

      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        messages.push(aiResponse);
        const toolResult = await ToolExecutor.executeToolCalls(
          aiResponse.tool_calls,
          this.tools,
          messages,
          attachments,
          {
            traceId: options.traceId,
            nodeId: options.nodeId,
            parentId: options.parentId,
            agentId: this.agentId,
            agentName: this.agentName,
            currentInitiator: options.currentInitiator,
            depth: options.depth,
            sessionId: options.sessionId,
            userId: options.userId,
            mainConversationId: options.mainConversationId,
            activeModel: options.activeModel,
            activeProvider: options.activeProvider,
            userText: options.userText,
          },
          tracer,
          approvedToolCalls
        );

        usage.toolCallCount += toolResult.toolCallCount;
        if (toolResult.paused) {
          return this.handlePausedToolResult(
            aiResponse,
            toolResult,
            attachments,
            approvedToolCalls
          );
        }
        iterations++;
      } else {
        responseText = aiResponse.content ?? '';
        break;
      }
    }

    usage.durationMs = Date.now() - loopStartTime;
    return this.finalizeResult(
      responseText,
      iterations,
      maxIterations,
      lastAiResponse,
      attachments,
      usage
    );
  }

  async *streamLoop(
    messages: Message[],
    options: ExecutorOptions
  ): AsyncIterable<import('../types/index').MessageChunk> {
    const { maxIterations, tracer, emitter, traceId, sessionId, userId, approvedToolCalls } =
      options;
    let iterations = 0;
    const usage: ExecutorUsage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      toolCallCount: 0,
      durationMs: 0,
    };

    if (emitter) {
      yield {
        content: '',
        'detail-type': 'chunk',
        thought: '',
        messageId: traceId,
        agentName: this.agentName,
      };
    }

    while (iterations < maxIterations) {
      await tracer.addStep({
        type: TRACE_TYPES.LLM_CALL,
        content: {
          messageCount: messages.length,
          model: options.activeModel,
          provider: options.activeProvider,
        },
      });

      const capabilities = await this.provider.getCapabilities(options.activeModel);
      const normalizedProfile = normalizeProfile(
        options.activeProfile,
        capabilities,
        options.activeModel ?? 'default'
      );

      const stream = this.provider.stream(
        messages,
        this.tools,
        normalizedProfile,
        options.activeModel,
        options.activeProvider,
        capabilities.supportsStructuredOutput ? options.responseFormat : undefined
      );

      logger.info(
        `[Executor] Starting stream loop for agent ${this.agentId} | traceId: ${traceId}`
      );

      let fullContent = '';
      let fullThought = '';
      const toolCalls: ToolCall[] = [];
      let jsonMessageExtracted = false;

      for await (const chunk of stream) {
        if (chunk.thought) {
          fullThought += chunk.thought;
          if (emitter) {
            emitter.emitChunk(userId, sessionId, traceId, chunk.thought, this.agentName, true);
          }
        }

        if (chunk.content) {
          if (options.communicationMode === 'json') {
            fullContent += chunk.content;
            if (!jsonMessageExtracted) {
              const messageMatch = fullContent.match(
                /"(?:message|plan|responseText)"\s*:\s*"((?:[^"\\]|\\.)*)$/
              );
              if (messageMatch) {
                jsonMessageExtracted = true;
                let newText = messageMatch[1];
                // Handle basic escapes if any
                newText = newText.replace(/\\n/g, '\n').replace(/\\"/g, '"');
                if (newText && emitter)
                  emitter.emitChunk(userId, sessionId, traceId, newText, this.agentName, false);
              }
            } else if (emitter) {
              emitter.emitChunk(userId, sessionId, traceId, chunk.content, this.agentName, false);
            }
          } else {
            // Text mode: emit chunks to UI as they arrive
            fullContent += chunk.content;
            if (emitter) {
              // Standard text mode: emit chunks to UI
              emitter.emitChunk(userId, sessionId, traceId, chunk.content, this.agentName, false);
            }
          }
        }

        if (chunk.tool_calls) {
          toolCalls.push(...chunk.tool_calls);
        }

        if (chunk.usage) {
          this.updateUsage(usage, { usage: chunk.usage }, options.activeProvider);
        }

        // Always yield the chunk if it contains any data
        if (chunk.content || chunk.thought || chunk.tool_calls || chunk.usage) {
          yield chunk;
        }
      }

      await tracer.addStep({
        type: TRACE_TYPES.LLM_RESPONSE,
        content: {
          content: fullContent,
          thought: fullThought,
          tool_calls: toolCalls,
          usage: usage,
        },
      });

      if (toolCalls.length === 0) break;

      // Handle tool approval/pausing in stream
      const approvalResult = await this.handleStreamToolCalls(toolCalls, messages, options);
      if (approvalResult) {
        yield approvalResult;
        break;
      }

      // Pre-tool execution acknowledgement for pausing tools
      const isPauseTool = toolCalls.some((tc) =>
        ['dispatchTask', 'seekClarification'].includes(tc.function.name)
      );
      if (isPauseTool && !fullContent) {
        const ackMsg = `I'm on it. I'll engage the appropriate agent for you.`;
        if (emitter) {
          emitter.emitChunk(userId, sessionId, traceId, ackMsg, this.agentName);
        }
        yield { content: ackMsg };
      }

      const toolResult = await ToolExecutor.executeToolCalls(
        toolCalls,
        this.tools,
        messages,
        [],
        {
          traceId: options.traceId,
          nodeId: options.nodeId,
          parentId: options.parentId,
          agentId: this.agentId,
          agentName: this.agentName,
          currentInitiator: options.currentInitiator,
          depth: options.depth,
          sessionId: options.sessionId,
          userId: options.userId,
          mainConversationId: options.mainConversationId,
          activeModel: options.activeModel,
          activeProvider: options.activeProvider,
          userText: options.userText,
        },
        tracer,
        approvedToolCalls
      );

      if (toolResult.paused) {
        if (toolResult.responseText) {
          const pauseMessage = `\n\n${ExecutorHelper.formatUserFriendlyResponse(toolResult.responseText)}`;
          if (emitter) {
            emitter.emitChunk(userId, sessionId, traceId, pauseMessage, this.agentName);
          }
          yield { content: pauseMessage };
        }
        break;
      }
      iterations++;
    }
    yield {
      usage: {
        prompt_tokens: usage.totalInputTokens,
        completion_tokens: usage.totalOutputTokens,
        total_tokens: usage.totalInputTokens + usage.totalOutputTokens,
      },
    };
  }

  private async performPreLoopChecks(
    messages: Message[],
    attachments: NonNullable<Message['attachments']>,
    options: ExecutorOptions
  ) {
    if (options.sessionStateManager && options.sessionId) {
      this.lastInjectedMessageTimestamp = await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        options.sessionId,
        this.agentId,
        this.lastInjectedMessageTimestamp,
        options.sessionStateManager
      );
      await options.sessionStateManager.renewProcessing(options.sessionId, this.agentId);
    }

    const timeoutResult = ExecutorHelper.checkTimeouts(
      Date.now(),
      options.taskTimeoutMs,
      options.timeoutBehavior,
      options.context
    );
    if (timeoutResult) return timeoutResult;

    const cancellationMsg = await ExecutorHelper.checkCancellation(options.taskId);
    if (cancellationMsg) return { responseText: cancellationMsg };

    await this.manageContext(messages, options.activeModel, options.activeProvider);
    return null;
  }

  private async callLLM(messages: Message[], options: ExecutorOptions): Promise<Message> {
    await options.tracer.addStep({
      type: TRACE_TYPES.LLM_CALL,
      content: {
        messageCount: messages.length,
        model: options.activeModel,
        provider: options.activeProvider,
      },
    });

    const capabilities = await this.provider.getCapabilities(options.activeModel);
    const normalizedProfile = normalizeProfile(
      options.activeProfile,
      capabilities,
      options.activeModel ?? 'default'
    );

    return this.provider.call(
      messages,
      this.tools,
      normalizedProfile,
      options.activeModel,
      options.activeProvider,
      capabilities.supportsStructuredOutput ? options.responseFormat : undefined
    );
  }

  private updateUsage(usage: ExecutorUsage, response: Partial<Message>, provider?: string) {
    if (response.usage) {
      usage.totalInputTokens += response.usage.prompt_tokens;
      usage.totalOutputTokens += response.usage.completion_tokens;
      this.emitTokenMetrics(response.usage, provider);
    }
  }

  private handlePausedToolResult(
    aiResponse: Message,
    toolResult: {
      paused?: boolean;
      responseText?: string;
      asyncWait?: boolean;
      toolCallCount: number;
    },
    attachments: NonNullable<Message['attachments']>,
    approvedToolCalls?: string[]
  ): LoopResult {
    const isApproval = toolResult.asyncWait && !toolResult.responseText;
    const pendingToolName = this.getPendingToolName(aiResponse, approvedToolCalls);
    const toolIndex = Math.max(0, toolResult.toolCallCount - 1);
    const callId = aiResponse.tool_calls![toolIndex].id;

    return {
      responseText: isApproval
        ? ExecutorHelper.formatApprovalMessage(pendingToolName, callId)
        : aiResponse.content ||
          ExecutorHelper.formatUserFriendlyResponse(toolResult.responseText || ''),
      paused: true,
      asyncWait: toolResult.asyncWait,
      pauseMessage: isApproval ? `APPROVAL_REQUIRED:${callId}` : toolResult.responseText,
      attachments,
      thought: aiResponse.thought,
      tool_calls: aiResponse.tool_calls,
      options: isApproval
        ? [
            { label: 'Approve Execution', value: `APPROVE_TOOL_CALL:${callId}`, type: 'primary' },
            { label: 'Reject', value: `REJECT_TOOL_CALL:${callId}`, type: 'danger' },
          ]
        : undefined,
    };
  }

  private async handleStreamToolCalls(
    toolCalls: ToolCall[],
    messages: Message[],
    options: ExecutorOptions
  ) {
    const { emitter, userId, sessionId, traceId, approvedToolCalls } = options;
    for (const tc of toolCalls) {
      const tool = this.tools.find((t) => t.name === tc.function.name);
      if (tool?.requiresApproval && !approvedToolCalls?.includes(tc.id)) {
        const approvalMsg = ExecutorHelper.formatApprovalMessage(tool.name, tc.id);
        const opts = [
          { label: 'Approve Execution', value: `APPROVE_TOOL_CALL:${tc.id}`, type: 'primary' },
          { label: 'Reject', value: `REJECT_TOOL_CALL:${tc.id}`, type: 'danger' },
        ];
        if (emitter)
          emitter.emitChunk(
            userId,
            sessionId,
            traceId,
            `\n\n${approvalMsg}`,
            this.agentName,
            false,
            opts as NonNullable<Message['options']>
          );
        return { content: `\n\n${approvalMsg}`, options: opts as NonNullable<Message['options']> };
      }
    }
    messages.push({ role: MessageRole.ASSISTANT, content: '', tool_calls: toolCalls });
    return null;
  }

  private finalizeResult(
    responseText: string,
    iterations: number,
    maxIterations: number,
    lastAiResponse: Message | undefined,
    attachments: NonNullable<Message['attachments']>,
    usage: ExecutorUsage
  ): LoopResult {
    if (!responseText && iterations >= maxIterations) {
      return {
        responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT,
        paused: true,
        pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT,
        attachments,
        tool_calls: lastAiResponse?.tool_calls,
        usage,
      };
    }
    return {
      responseText: responseText || 'Task completed.',
      attachments: attachments.length > 0 ? attachments : undefined,
      thought: lastAiResponse?.thought,
      tool_calls: lastAiResponse?.tool_calls,
      usage,
    };
  }

  private async manageContext(messages: Message[], model?: string, provider?: string) {
    const currentTokens = ContextManager.estimateTokens(messages);
    if (currentTokens > this.contextLimit * 0.9 && this.systemPrompt) {
      const rebuilt = await ContextManager.getManagedContext(
        messages,
        this.summary,
        this.systemPrompt,
        this.contextLimit,
        { model, provider }
      );
      messages.length = 0;
      messages.push(...rebuilt.messages);
      logger.warn(`Context truncation: ${currentTokens}→${rebuilt.tokenEstimate} tokens.`);
    }
  }

  private async emitTokenMetrics(usage: NonNullable<Message['usage']>, provider?: string) {
    if (!process.env.VITEST) {
      try {
        const { emitMetrics, METRICS } = await import('../metrics');
        emitMetrics([
          METRICS.tokensInput(usage.prompt_tokens, this.agentId, provider ?? 'unknown'),
          METRICS.tokensOutput(usage.completion_tokens, this.agentId, provider ?? 'unknown'),
        ]).catch(() => undefined);
      } catch {
        return;
      }
    }
  }

  private getPendingToolName(aiResponse: Message, approvedToolCalls?: string[]): string {
    const pending = aiResponse.tool_calls?.find((tc) => !approvedToolCalls?.includes(tc.id));
    return pending?.function.name || 'Unknown Tool';
  }
}
