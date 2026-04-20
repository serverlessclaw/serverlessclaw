import { Message, ButtonType } from '../../types/index';
import { TRACE_TYPES } from '../../constants';
import {
  AGENT_LOG_MESSAGES,
  LoopResult,
  ExecutorUsage,
  ExecutorOptions,
  validateExecutorOptions,
} from '../executor-types';
import { ExecutorHelper } from '../executor-helper';
import { ToolExecutor } from '../tool-executor';
import { BaseExecutor } from './base-executor';
import { BudgetEnforcer } from './budget-enforcer';

/**
 * Standard non-streaming executor.
 */
export class StandardExecutor extends BaseExecutor {
  async runLoop(messages: Message[], options: ExecutorOptions): Promise<LoopResult> {
    validateExecutorOptions(options);

    const { maxIterations, tracer, approvedToolCalls } = options;

    this.handleInteractiveSignals(messages, options);

    let iterations = 0;
    let responseText = '';
    const attachments: NonNullable<Message['attachments']> = [];
    const ui_blocks: NonNullable<Message['ui_blocks']> = [];
    let lastAiResponse: Message | undefined;
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

      if (aiResponse.content && options.sessionId) {
        const loopResult = await this.checkSemanticLoop(options.sessionId, aiResponse.content);
        if (loopResult) return { ...loopResult, usage };
      }

      const postCallLimit = BudgetEnforcer.check(this.agentId, options, usage);
      if (postCallLimit && !postCallLimit.isWarning) {
        return { ...postCallLimit, attachments };
      }

      await options.tracer.addStep({
        type: TRACE_TYPES.LLM_RESPONSE,
        content: {
          model: options.activeModel,
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
    const isApproval = toolResult.asyncWait && !toolResult.responseText?.startsWith('TASK_PAUSED');
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

  private getPendingToolName(aiResponse: Message, approvedToolCalls?: string[]): string {
    const pending = aiResponse.tool_calls?.find((tc) => !approvedToolCalls?.includes(tc.id));
    return pending?.function.name || 'Unknown Tool';
  }
}
