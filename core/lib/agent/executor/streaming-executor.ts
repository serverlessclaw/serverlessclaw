import {
  Message,
  MessageRole,
  ToolCall,
  MessageChunk,
  ButtonType,
  EventType,
} from '../../types/index';
import { ReasoningProfile } from '../../types/index';
import { normalizeProfile } from '../../providers/utils';
import { TRACE_TYPES } from '../../constants';
import { ExecutorUsage, ExecutorOptions } from '../executor-types';
import { ExecutorHelper } from '../executor-helper';
import { ToolExecutor } from '../tool-executor';
import { BaseExecutor } from './base-executor';

/**
 * Streaming executor implementation.
 */
export class StreamingExecutor extends BaseExecutor {
  async *streamLoop(messages: Message[], options: ExecutorOptions): AsyncIterable<MessageChunk> {
    const {
      maxIterations,
      tracer,
      emitter,
      traceId,
      sessionId,
      userId,
      approvedToolCalls,
      taskId,
    } = options;

    const agentSuffix =
      options.currentInitiator === 'orchestrator' || this.agentId === 'superclaw'
        ? 'superclaw'
        : this.agentId;
    const assistantMessageId = `${traceId}-${agentSuffix}`;

    yield { messageId: assistantMessageId } as MessageChunk;

    const cancellationMsg = await ExecutorHelper.checkCancellation(taskId);
    if (cancellationMsg) {
      if (emitter) {
        await emitter.emitChunk(
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

    this.handleInteractiveSignals(messages, options);

    let iterations = 0;
    const attachments: NonNullable<Message['attachments']> = [];
    const priorUsage = options.priorTokenUsage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    const usage: ExecutorUsage = {
      totalInputTokens: priorUsage.inputTokens,
      totalOutputTokens: priorUsage.outputTokens,
      total_tokens: priorUsage.totalTokens,
      toolCallCount: 0,
      durationMs: 0,
    };
    const loopStartTime = Date.now();
    let fullContent = '';
    let fullThought = '';

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

      const effectiveMaxTokens = this.getClampedMaxTokens(options, usage);

      await tracer.addStep({
        type: TRACE_TYPES.LLM_CALL,
        content: {
          model: options.activeModel,
          provider: options.activeProvider,
          profile: normalizedProfile,
          maxTokens: effectiveMaxTokens,
        },
      });

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

      // Emit a synthetic thinking marker before content streaming starts so the UI always
      // shows thinking first for thinking/deep profiles.
      // Use the REQUESTED profile (pre-normalization) so non-reasoning models (e.g. gpt-4o-mini)
      // still show the thinking indicator when the user has toggled thinking on.
      const shouldPrefaceThinking =
        options.activeProfile === ReasoningProfile.THINKING ||
        options.activeProfile === ReasoningProfile.DEEP ||
        normalizedProfile === 'thinking' ||
        normalizedProfile === 'deep';

      if (shouldPrefaceThinking && emitter) {
        await emitter.emitChunk(
          userId,
          sessionId,
          traceId,
          undefined,
          this.agentName,
          true,
          undefined,
          options.currentInitiator,
          '\u2026',
          undefined,
          undefined,
          EventType.TEXT_MESSAGE_CONTENT
        );
      }

      const toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.content) {
          const contentDelta = chunk.content;
          fullContent += contentDelta;
          if (emitter) {
            await emitter.emitChunk(
              userId,
              sessionId,
              traceId,
              contentDelta, // Emit DELTA for streaming
              this.agentName,
              false,
              undefined,
              options.currentInitiator,
              undefined,
              undefined,
              undefined,
              EventType.TEXT_MESSAGE_CONTENT
            );
          }
        }

        if (chunk.thought) {
          const thoughtDelta = chunk.thought;
          // Don't accumulate synthetic thinking markers — they only trigger the UI indicator
          if (thoughtDelta !== '\u2026') {
            fullThought += thoughtDelta;
          }
          if (emitter) {
            await emitter.emitChunk(
              userId,
              sessionId,
              traceId,
              undefined,
              this.agentName,
              true,
              undefined,
              options.currentInitiator,
              thoughtDelta,
              undefined,
              undefined,
              EventType.TEXT_MESSAGE_CONTENT
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

      if (fullContent && options.sessionId) {
        const loopResult = await this.checkSemanticLoop(options.sessionId, fullContent);
        if (loopResult) {
          yield { content: loopResult.responseText, usage } as unknown as MessageChunk;
          break;
        }
      }

      await tracer.addStep({
        type: TRACE_TYPES.LLM_RESPONSE,
        content: {
          model: options.activeModel,
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

      // Emit progress signal if executing tools
      if (!isPauseTool && emitter) {
        const toolNames = toolCalls.map((tc) => tc.function.name).join(', ');
        await emitter.emitChunk(
          userId,
          sessionId,
          traceId,
          undefined,
          this.agentName,
          true,
          undefined,
          options.currentInitiator,
          `I am executing: ${toolNames}...`
        );
      }

      if (isPauseTool && !fullContent) {
        const ackMsg = `I'm on it. I'll engage the appropriate agent for you.`;
        if (emitter) {
          await emitter.emitChunk(
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
          workspaceId: options.workspaceId,
          userId: options.userId,
          mainConversationId: options.mainConversationId,
          activeModel: options.activeModel,
          activeProvider: options.activeProvider,
          userText: options.userText,
          agentConfig: this.agentConfig,
        },
        tracer,
        approvedToolCalls
      );

      if (attachments.length > attachmentsBefore) {
        const newAttachments = attachments.slice(attachmentsBefore);
        if (emitter) {
          await emitter.emitChunk(
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

      if (toolResult.ui_blocks && toolResult.ui_blocks.length > 0 && emitter) {
        await emitter.emitChunk(
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
        yield { ui_blocks: toolResult.ui_blocks } as MessageChunk;
      }

      if (toolResult.paused) {
        if (toolResult.responseText) {
          const pauseMessage = `\n\n${ExecutorHelper.formatUserFriendlyResponse(toolResult.responseText)}`;
          if (emitter) {
            await emitter.emitChunk(
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

    if (emitter) {
      await emitter.emitChunk(
        userId,
        sessionId,
        traceId,
        fullContent,
        this.agentName,
        false,
        undefined,
        options.currentInitiator,
        fullThought,
        undefined,
        undefined,
        EventType.OUTBOUND_MESSAGE
      );
    }

    yield {
      usage: {
        prompt_tokens: usage.totalInputTokens,
        completion_tokens: usage.totalOutputTokens,
        total_tokens: usage.total_tokens,
      },
    } as MessageChunk;
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
          await emitter.emitChunk(
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
    messages.push({
      role: MessageRole.ASSISTANT,
      content: '',
      tool_calls: toolCalls,
      traceId: options.traceId,
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    });
    return null;
  }
}
