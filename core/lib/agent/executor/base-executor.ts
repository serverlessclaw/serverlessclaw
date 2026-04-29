import { Message, ITool, IProvider, MessageRole, IAgentConfig } from '../../types/index';
import { TRACE_TYPES } from '../../constants';
import { logger } from '../../logger';
import { normalizeProfile } from '../../providers/utils';
import { LIMITS } from '../../constants';
import { ContextManager } from '../context-manager';
import { LoopResult, ExecutorUsage, ExecutorOptions } from '../executor-types';
import { ExecutorHelper } from '../executor-helper';
import { BudgetEnforcer } from './budget-enforcer';
import { getSemanticLoopDetector, TrustManager } from '../../safety';
import { NegativeMemory } from '../../memory/negative-memory';

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

    await this.manageContext(
      messages,
      options.activeModel,
      options.activeProvider,
      options.traceId
    );

    if (options.sessionId && options.sessionStateManager) {
      this.lastInjectedMessageTimestamp = await ExecutorHelper.injectPendingMessages(
        messages,
        attachments,
        options.sessionId,
        this.agentId,
        this.lastInjectedMessageTimestamp,
        options.sessionStateManager,
        options.traceId,
        {
          workspaceId: options.workspaceId,
          teamId: options.teamId,
          staffId: options.staffId,
        }
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

    await options.tracer.addStep({
      type: TRACE_TYPES.LLM_CALL,
      content: {
        model: options.activeModel,
        provider: options.activeProvider,
        profile: normalizedProfile,
        maxTokens,
      },
    });

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

  protected updateUsage(
    usage: ExecutorUsage,
    response: Partial<Message>,
    provider?: string,
    options?: ExecutorOptions
  ) {
    if (response.usage) {
      usage.totalInputTokens += response.usage.prompt_tokens;
      usage.totalOutputTokens += response.usage.completion_tokens;
      usage.total_tokens = usage.totalInputTokens + usage.totalOutputTokens;
      this.emitTokenMetrics(response.usage, provider, options);
    }
  }

  protected async manageContext(
    messages: Message[],
    model?: string,
    provider?: string,
    traceId?: string
  ) {
    const currentTokens = ContextManager.estimateTokens(messages);
    if (currentTokens > this.contextLimit * 0.9 && this.systemPrompt) {
      const rebuilt = await ContextManager.getManagedContext(
        messages,
        this.summary,
        this.systemPrompt,
        this.contextLimit,
        { model, provider },
        traceId
      );
      messages.length = 0;
      messages.push(...rebuilt.messages);
      logger.warn(`Context truncation: ${currentTokens}→${rebuilt.tokenEstimate} tokens.`);
    }
  }

  protected async emitTokenMetrics(
    usage: NonNullable<Message['usage']>,
    provider?: string,
    options?: ExecutorOptions
  ) {
    if (!process.env.VITEST) {
      try {
        const { emitMetrics, METRICS } = await import('../../metrics');
        const metricScope = options
          ? {
              workspaceId: options.workspaceId,
              teamId: options.teamId,
              staffId: options.staffId,
            }
          : undefined;

        emitMetrics([
          METRICS.tokensInput(
            usage.prompt_tokens,
            this.agentId,
            provider ?? 'unknown',
            metricScope
          ),
          METRICS.tokensOutput(
            usage.completion_tokens,
            this.agentId,
            provider ?? 'unknown',
            metricScope
          ),
        ]).catch(() => undefined);
      } catch {
        return;
      }
    }
  }

  protected async checkSemanticLoop(
    sessionId: string,
    currentContent: string,
    options: ExecutorOptions
  ): Promise<LoopResult | null> {
    const loopDetector = getSemanticLoopDetector();
    const loopResult = loopDetector.check(sessionId, currentContent);

    if (loopResult.isLoop) {
      logger.warn(
        `[${this.agentId}] Semantic loop detected (count: ${loopResult.consecutiveCount}). Penalizing trust.`
      );
      await TrustManager.recordFailure(
        this.agentId,
        `Semantic reasoning loop detected (${loopResult.consecutiveCount} turns).`,
        3,
        undefined,
        {
          workspaceId: options.workspaceId,
          teamId: options.teamId,
          staffId: options.staffId,
        }
      );

      if (loopResult.action === 'escalate' || loopResult.action === 'switch_agent') {
        return {
          responseText: `[LOOP_DETECTED] I'm stuck in a reasoning loop. Escalating for intervention.`,
          paused: true,
        };
      }
    }
    return null;
  }

  protected getClampedMaxTokens(
    options: ExecutorOptions,
    usage: ExecutorUsage
  ): number | undefined {
    let maxTokens = options.maxTokens;
    if (options.tokenBudget && usage) {
      const remaining = options.tokenBudget - usage.total_tokens;
      if (remaining > 0 && remaining < (maxTokens ?? Infinity)) {
        maxTokens = Math.min(maxTokens ?? remaining, remaining);
        logger.info(`[${this.agentId}] Clamping maxTokens to remaining budget: ${maxTokens}`);
      }
    }
    return maxTokens;
  }

  protected handleInteractiveSignals(messages: Message[], options: ExecutorOptions) {
    const { userText } = options;
    if (!userText) return;

    // 1. Tool Rejection (Legacy and Modern)
    if (userText.startsWith('TOOL_REJECTION:') || userText.startsWith('REJECT_TOOL_CALL:')) {
      const match = userText.match(/(?:TOOL_REJECTION|REJECT_TOOL_CALL):([^\s:]+)(?:[\s:]+(.*))?/);
      if (match) {
        const [, callId, reason] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_REJECTED_EXECUTION: ${reason || 'User rejected this tool execution.'}`,
          traceId: options.traceId,
          messageId: `msg-rej-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        });
        return;
      }
    }

    // 2. Tool Clarification (Legacy and Modern)
    if (userText.startsWith('TOOL_CLARIFICATION:') || userText.startsWith('CLARIFY_TOOL_CALL:')) {
      const match = userText.match(
        /(?:TOOL_CLARIFICATION|CLARIFY_TOOL_CALL):([^\s:]+)(?:[\s:]+(.*))?/
      );
      if (match) {
        const [, callId, comment] = match;
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: callId,
          content: `USER_CLARIFICATION: ${comment || ''}`,
          traceId: options.traceId,
          messageId: `msg-clar-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        });
        return;
      }
    }

    // 3. Tool Approval (Modern Only)
    if (userText.startsWith('APPROVE_TOOL_CALL:')) {
      const match = userText.match(/APPROVE_TOOL_CALL:([^\s:]+)/);
      if (match) {
        const [, callId] = match;
        // Optimization: In standard executors, this signal is usually absorbed by the approval logic,
        // but if it reaches here, we treat it as an explicit approval instruction.
        logger.info(`[${this.agentId}] Received explicit signal for tool approval: ${callId}`);
      }
    }
  }

  protected async recordPlanFailure(
    task: string,
    plan: string,
    reason: string,
    options: ExecutorOptions
  ) {
    try {
      const negMemory = new NegativeMemory();
      await negMemory.recordFailure(this.agentId, task, plan, reason, {
        traceId: options.traceId,
        scope: {
          workspaceId: options.workspaceId,
          orgId: options.orgId,
          teamId: options.teamId,
          staffId: options.staffId,
        },
      });
    } catch (e) {
      logger.warn(`[${this.agentId}] Failed to record plan failure:`, e);
    }
  }
}
