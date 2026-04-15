import { Message, ITool, IProvider, MessageRole, IAgentConfig } from '../../types/index';
import { logger } from '../../logger';
import { normalizeProfile } from '../../providers/utils';
import { LIMITS } from '../../constants';
import { ContextManager } from '../context-manager';
import { LoopResult, ExecutorUsage, ExecutorOptions } from '../executor-types';
import { ExecutorHelper } from '../executor-helper';
import { BudgetEnforcer } from './budget-enforcer';

/**
 * Shared logic for all executor implementations.
 */
export abstract class BaseExecutor {
  protected lastInjectedMessageTimestamp: number = Date.now();

  constructor(
    protected provider: IProvider,
    protected tools: ITool[],
    protected agentId: string,
    protected agentName: string,
    protected systemPrompt: string = '',
    protected summary: string | null = null,
    protected contextLimit: number = LIMITS.MAX_CONTEXT_LENGTH,
    protected agentConfig?: IAgentConfig
  ) {}

  protected async performPreLoopChecks(
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

    const budgetResult = BudgetEnforcer.check(this.agentId, options, currentUsage);
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
        options.sessionStateManager,
        options.traceId
      );
    }

    return null;
  }

  protected async callLLM(
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

  protected updateUsage(usage: ExecutorUsage, response: Partial<Message>, provider?: string) {
    if (response.usage) {
      usage.totalInputTokens += response.usage.prompt_tokens;
      usage.totalOutputTokens += response.usage.completion_tokens;
      usage.total_tokens = usage.totalInputTokens + usage.totalOutputTokens;
      this.emitTokenMetrics(response.usage, provider);
    }
  }

  protected async manageContext(messages: Message[], model?: string, provider?: string) {
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

  protected async emitTokenMetrics(usage: NonNullable<Message['usage']>, provider?: string) {
    if (!process.env.VITEST) {
      try {
        const { emitMetrics, METRICS } = await import('../../metrics');
        emitMetrics([
          METRICS.tokensInput(usage.prompt_tokens, this.agentId, provider ?? 'unknown'),
          METRICS.tokensOutput(usage.completion_tokens, this.agentId, provider ?? 'unknown'),
        ]).catch(() => undefined);
      } catch {
        return;
      }
    }
  }

  protected handleInteractiveSignals(messages: Message[], options: ExecutorOptions) {
    const { userText } = options;
    if (userText?.startsWith('TOOL_REJECTION:')) {
      const match = userText.match(/TOOL_REJECTION:([^\s]+)\s*(.*)/);
      if (match) {
        const [, callId, reason] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_REJECTED_EXECUTION: ${reason || 'User rejected this tool execution.'}`,
          traceId: options.traceId,
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
          traceId: options.traceId,
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        });
      }
    }
  }
}
