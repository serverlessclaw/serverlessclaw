import {
  Message,
  ITool,
  IProvider,
  MessageRole,
  ToolCall,
  MessageChunk,
  ButtonType,
} from '../types/index';
import { logger } from '../logger';
import { normalizeProfile } from '../providers/utils';
import { LIMITS, TRACE_TYPES } from '../constants';
import { ContextManager } from './context-manager';
import {
  AGENT_LOG_MESSAGES,
  LoopResult,
  ExecutorUsage,
  ExecutorOptions,
  validateExecutorOptions,
} from './executor-types';
import { ExecutorHelper } from './executor-helper';
import { ToolExecutor } from './tool-executor';

/**
 * Core implementation of the iterative execution loop.
 */
export class ExecutorCore {
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
    validateExecutorOptions(options);

    const { maxIterations, tracer, approvedToolCalls, userText } = options;

    // Handle high-level interactive signals before starting the loop
    if (userText?.startsWith('TOOL_REJECTION:')) {
      const match = userText.match(/TOOL_REJECTION:([^\s]+)\s*(.*)/);
      if (match) {
        const [, callId, reason] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_REJECTED_EXECUTION: ${reason || 'User rejected this tool execution.'}`,
        });
      }
    } else if (userText?.startsWith('TOOL_CLARIFICATION:')) {
      const match = userText.match(/TOOL_CLARIFICATION:([^\s]+)\s*(.*)/);
      if (match) {
        const [, callId, comment] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_CLARIFICATION: ${comment}`,
        });
      }
    }

    let iterations = 0;
    let responseText = '';
    const attachments: NonNullable<Message['attachments']> = [];
    const ui_blocks: NonNullable<Message['ui_blocks']> = [];
    let lastAiResponse: Message | undefined;
    const usage: ExecutorUsage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      total_tokens: 0,
      toolCallCount: 0,
      durationMs: 0,
    };
    const loopStartTime = Date.now();

    while (iterations < maxIterations) {
      const errorResult = await this.performPreLoopChecks(
        messages,
        attachments,
        options,
        loopStartTime,
        usage
      );
      if (errorResult) return { ...errorResult, attachments };

      const aiResponse = await this.callLLM(messages, options, usage);
      lastAiResponse = aiResponse;
      this.updateUsage(usage, aiResponse, options.activeProvider);

      await options.tracer.addStep({
        type: TRACE_TYPES.LLM_RESPONSE,
        content: {
          content: aiResponse.content,
          thought: aiResponse.thought,
          tool_calls: aiResponse.tool_calls,
          usage: {
            ...aiResponse.usage,
            totalInputTokens: usage.totalInputTokens,
            totalOutputTokens: usage.totalOutputTokens,
            total_tokens: usage.total_tokens,
          },
        },
      });

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
        if (toolResult.ui_blocks) {
          ui_blocks.push(...toolResult.ui_blocks);
        }
        if (toolResult.paused) {
          return this.handlePausedToolResult(
            aiResponse,
            toolResult,
            attachments,
            approvedToolCalls,
            ui_blocks
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
      usage,
      ui_blocks
    );
  }

  async *streamLoop(messages: Message[], options: ExecutorOptions): AsyncIterable<MessageChunk> {
    const {
      maxIterations,
      tracer,
      emitter,
      traceId,
      sessionId,
      userId,
      approvedToolCalls,
      userText,
      taskId,
    } = options;

    yield { messageId: traceId || taskId } as MessageChunk;

    const cancellationMsg = await ExecutorHelper.checkCancellation(taskId);
    if (cancellationMsg) {
      if (emitter) {
        emitter.emitChunk(
          userId,
          sessionId,
          traceId,
          cancellationMsg,
          this.agentName,
          false,
          undefined,
          options.currentInitiator
        );
      }
      yield { content: cancellationMsg };
      return;
    }

    // Handle high-level interactive signals before starting the loop
    if (userText?.startsWith('TOOL_REJECTION:')) {
      const match = userText.match(/TOOL_REJECTION:([^\s]+)\s*(.*)/);
      if (match) {
        const [, callId, reason] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_REJECTED_EXECUTION: ${reason || 'User rejected this tool execution.'}`,
        });
      }
    } else if (userText?.startsWith('TOOL_CLARIFICATION:')) {
      const match = userText.match(/TOOL_CLARIFICATION:([^\s]+)\s*(.*)/);
      if (match) {
        const [, callId, comment] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_CLARIFICATION: ${comment}`,
        });
      }
    }

    let iterations = 0;
    const attachments: NonNullable<Message['attachments']> = [];
    const usage: ExecutorUsage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      total_tokens: 0,
      toolCallCount: 0,
      durationMs: 0,
    };
    const loopStartTime = Date.now();

    while (iterations < maxIterations) {
      const errorResult = await this.performPreLoopChecks(
        messages,
        attachments,
        options,
        loopStartTime,
        usage
      );
      if (errorResult) {
        yield { content: errorResult.responseText, attachments: errorResult.attachments };
        break;
      }

      await this.manageContext(messages, options.activeModel, options.activeProvider);

      const capabilities = await this.provider.getCapabilities(options.activeModel);
      const normalizedProfile = normalizeProfile(
        options.activeProfile,
        capabilities,
        options.activeModel
      );

      let effectiveMaxTokens = options.maxTokens;
      if (options.tokenBudget && usage) {
        const remaining = options.tokenBudget - usage.total_tokens;
        if (remaining > 0 && remaining < (effectiveMaxTokens ?? Infinity)) {
          effectiveMaxTokens = Math.min(effectiveMaxTokens ?? remaining, remaining);
          logger.info(
            `[${this.agentId}] Clamping stream maxTokens to remaining budget: ${effectiveMaxTokens}`
          );
        }
      }

      const stream = this.provider.stream(
        messages,
        this.tools,
        normalizedProfile,
        options.activeModel,
        options.activeProvider,
        options.responseFormat,
        options.temperature,
        effectiveMaxTokens,
        options.topP,
        options.stopSequences
      );

      let fullContent = '';
      let fullThought = '';
      const toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.content) {
          const contentDelta = chunk.content;
          fullContent += contentDelta;
          if (emitter) {
            emitter.emitChunk(
              userId,
              sessionId,
              traceId,
              contentDelta,
              this.agentName,
              false,
              undefined,
              options.currentInitiator
            );
          }
        }

        if (chunk.thought) {
          const thoughtDelta = chunk.thought;
          fullThought += thoughtDelta;
          if (emitter) {
            emitter.emitChunk(
              userId,
              sessionId,
              traceId,
              undefined,
              this.agentName,
              false,
              undefined,
              options.currentInitiator,
              thoughtDelta
            );
          }
        }

        if (chunk.tool_calls) {
          toolCalls.push(...chunk.tool_calls);
        }

        if (chunk.usage) {
          this.updateUsage(usage, { usage: chunk.usage }, options.activeProvider);
        }

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

      const approvalResult = await this.handleStreamToolCalls(toolCalls, messages, options);
      if (approvalResult) {
        yield approvalResult;
        break;
      }

      const isPauseTool = toolCalls.some((tc) =>
        ['dispatchTask', 'seekClarification'].includes(tc.function.name)
      );
      if (isPauseTool && !fullContent) {
        const ackMsg = `I'm on it. I'll engage the appropriate agent for you.`;
        if (emitter) {
          emitter.emitChunk(
            userId,
            sessionId,
            traceId,
            ackMsg,
            this.agentName,
            false,
            undefined,
            options.currentInitiator
          );
        }
        yield { content: ackMsg };
      }

      const attachmentsBefore = attachments.length;
      const toolResult = await ToolExecutor.executeToolCalls(
        toolCalls,
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

      // Yield new attachments if any
      if (attachments.length > attachmentsBefore) {
        const newAttachments = attachments.slice(attachmentsBefore);
        if (emitter) {
          emitter.emitChunk(
            userId,
            sessionId,
            traceId,
            undefined,
            this.agentName,
            false,
            undefined,
            options.currentInitiator,
            undefined,
            undefined,
            newAttachments
          );
        }
        yield { attachments: newAttachments } as MessageChunk;
      }

      // If we have ui_blocks in stream, we should probably emit them
      if (toolResult.ui_blocks && toolResult.ui_blocks.length > 0 && emitter) {
        emitter.emitChunk(
          userId,
          sessionId,
          traceId,
          undefined,
          this.agentName,
          false,
          undefined,
          options.currentInitiator,
          undefined,
          toolResult.ui_blocks
        );
        // Also yield them for the local stream caller
        yield { ui_blocks: toolResult.ui_blocks } as MessageChunk;
      }

      if (toolResult.paused) {
        if (toolResult.responseText) {
          const pauseMessage = `\n\n${ExecutorHelper.formatUserFriendlyResponse(toolResult.responseText)}`;
          if (emitter) {
            emitter.emitChunk(
              userId,
              sessionId,
              traceId,
              pauseMessage,
              this.agentName,
              false,
              undefined,
              options.currentInitiator
            );
          }
          yield { content: pauseMessage };
        }
        break;
      }
      iterations++;
    }

    usage.durationMs = Date.now() - loopStartTime;
    yield {
      usage: {
        prompt_tokens: usage.totalInputTokens,
        completion_tokens: usage.totalOutputTokens,
        total_tokens: usage.total_tokens,
      },
    } as MessageChunk;
  }

  private async performPreLoopChecks(
    messages: Message[],
    attachments: NonNullable<Message['attachments']>,
    options: ExecutorOptions,
    startTime: number,
    currentUsage?: ExecutorUsage
  ): Promise<LoopResult | null> {
    const cancellationMsg = await ExecutorHelper.checkCancellation(options.taskId);
    if (cancellationMsg) {
      return { responseText: cancellationMsg, paused: false };
    }

    const timeoutResult = ExecutorHelper.checkTimeouts(
      startTime,
      options.taskTimeoutMs,
      options.timeoutBehavior,
      options.context
    );
    if (timeoutResult) {
      return {
        ...timeoutResult,
        attachments,
      };
    }

    const budgetResult = this.checkBudgetEnforcement(options, currentUsage);
    if (budgetResult) {
      return budgetResult;
    }

    await this.manageContext(messages, options.activeModel, options.activeProvider);

    if (options.sessionId && options.sessionStateManager) {
      this.lastInjectedMessageTimestamp = await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        options.sessionId,
        this.agentId,
        this.lastInjectedMessageTimestamp,
        options.sessionStateManager
      );
    }

    return null;
  }

  private checkBudgetEnforcement(
    options: ExecutorOptions,
    currentUsage?: ExecutorUsage
  ): LoopResult | null {
    const { tokenBudget, costLimit } = options;

    if (!tokenBudget && !costLimit) {
      return null;
    }

    const consumedTokens = currentUsage?.total_tokens ?? 0;

    if (tokenBudget && consumedTokens >= tokenBudget) {
      logger.warn(`[${this.agentId}] Token budget exceeded: ${consumedTokens}/${tokenBudget}`);
      return {
        responseText: '[BUDGET_EXCEEDED] Token budget limit reached. Task terminated.',
        paused: true,
        pauseMessage: 'TOKEN_BUDGET_EXCEEDED',
        usage: currentUsage,
      };
    }

    if (costLimit && currentUsage) {
      const estimatedCost = this.estimateCost(currentUsage);
      if (estimatedCost >= costLimit) {
        logger.warn(
          `[${this.agentId}] Cost limit exceeded: $${estimatedCost.toFixed(4)}/$${costLimit}`
        );
        return {
          responseText: '[BUDGET_EXCEEDED] Cost limit reached. Task terminated.',
          paused: true,
          pauseMessage: 'COST_LIMIT_EXCEEDED',
          usage: currentUsage,
        };
      }
    }

    return null;
  }

  private estimateCost(usage: ExecutorUsage): number {
    const inputCost = (usage.totalInputTokens / 1_000_000) * 15;
    const outputCost = (usage.totalOutputTokens / 1_000_000) * 75;
    return inputCost + outputCost;
  }

  private async callLLM(
    messages: Message[],
    options: ExecutorOptions,
    currentUsage?: ExecutorUsage
  ): Promise<Message> {
    const { activeModel, activeProfile } = options;
    const capabilities = await this.provider.getCapabilities(activeModel);
    const normalizedProfile = normalizeProfile(activeProfile, capabilities, activeModel);

    let maxTokens = options.maxTokens;
    if (options.tokenBudget && currentUsage) {
      const remaining = options.tokenBudget - currentUsage.total_tokens;
      if (remaining > 0 && remaining < (maxTokens ?? Infinity)) {
        maxTokens = Math.min(maxTokens ?? remaining, remaining);
        logger.info(`[${this.agentId}] Clamping maxTokens to remaining budget: ${maxTokens}`);
      }
    }

    return this.provider.call(
      messages,
      this.tools,
      normalizedProfile,
      options.activeModel,
      options.activeProvider,
      capabilities.supportsStructuredOutput ? options.responseFormat : undefined,
      options.temperature,
      maxTokens,
      options.topP,
      options.stopSequences
    );
  }

  private updateUsage(usage: ExecutorUsage, response: Partial<Message>, provider?: string) {
    if (response.usage) {
      usage.totalInputTokens += response.usage.prompt_tokens;
      usage.totalOutputTokens += response.usage.completion_tokens;
      usage.total_tokens = usage.totalInputTokens + usage.totalOutputTokens;
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
    approvedToolCalls?: string[],
    ui_blocks?: Message['ui_blocks']
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
      ui_blocks,
      options: isApproval
        ? [
            {
              label: 'Approve Tool',
              value: `APPROVE_TOOL_CALL:${callId}`,
              type: 'primary' as ButtonType,
            },
            {
              label: 'Reject Tool',
              value: `REJECT_TOOL_CALL:${callId}`,
              type: 'danger' as ButtonType,
            },
            {
              label: 'Clarify',
              value: `CLARIFY_TOOL_CALL:${callId}`,
              type: 'secondary' as ButtonType,
            },
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
          {
            label: 'Approve Tool',
            value: `APPROVE_TOOL_CALL:${tc.id}`,
            type: 'primary' as ButtonType,
          },
          {
            label: 'Reject Tool',
            value: `REJECT_TOOL_CALL:${tc.id}`,
            type: 'danger' as ButtonType,
          },
          {
            label: 'Clarify',
            value: `CLARIFY_TOOL_CALL:${tc.id}`,
            type: 'secondary' as ButtonType,
          },
        ];
        if (emitter)
          emitter.emitChunk(
            userId,
            sessionId,
            traceId,
            `\n\n${approvalMsg}`,
            this.agentName,
            false,
            opts as NonNullable<Message['options']>,
            options.currentInitiator
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
    usage: ExecutorUsage,
    ui_blocks?: Message['ui_blocks']
  ): LoopResult {
    if (!responseText && iterations >= maxIterations) {
      return {
        responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT,
        paused: true,
        pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT,
        attachments,
        tool_calls: lastAiResponse?.tool_calls,
        usage,
        ui_blocks,
      };
    }
    return {
      responseText: responseText || 'Task completed.',
      attachments: attachments.length > 0 ? attachments : undefined,
      thought: lastAiResponse?.thought,
      tool_calls: lastAiResponse?.tool_calls,
      usage,
      ui_blocks: ui_blocks?.length ? ui_blocks : undefined,
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
