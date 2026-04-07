import { logger } from '../logger';
import { AgentRegistry } from '../registry';
import { DYNAMO_KEYS } from '../constants';
import { Message, MessageRole } from '../types/index';
import { AGENT_DEFAULTS, AGENT_LOG_MESSAGES } from './executor-types';
import { Context as LambdaContext } from 'aws-lambda';

export class ExecutorHelper {
  /**
   * Checks if global pause is active.
   */
  static async checkGlobalPause(): Promise<string | null> {
    try {
      const isPaused = await AgentRegistry.getRawConfig(DYNAMO_KEYS.GLOBAL_PAUSE);
      if (isPaused === true) {
        logger.warn(`Agent execution blocked: GLOBAL_PAUSE is active.`);
        return 'SYSTEM_PAUSED: All autonomous agent activities have been globally suspended by the administrator. Please contact your system operator to resume operations.';
      }
    } catch (e) {
      logger.error('Failed to check GLOBAL_PAUSE status, proceeding with caution:', e);
    }
    return null;
  }

  /**
   * Injects pending messages into the conversation.
   */
  static async injectPendingMessages(
    messages: Message[],
    attachments: NonNullable<Message['attachments']>,
    sessionId: string,
    agentId: string,
    lastInjectedMessageTimestamp: number,
    sessionStateManager: import('../session/session-state').SessionStateManager,
    traceId: string
  ): Promise<number> {
    const pendingMessages = await sessionStateManager.getPendingMessages(sessionId);
    const newMessages = pendingMessages.filter((m) => m.timestamp > lastInjectedMessageTimestamp);

    if (newMessages.length > 0) {
      logger.info(
        `[EXECUTOR] Found ${newMessages.length} new pending messages, injecting into context`
      );

      const maxTimestamp = Math.max(...newMessages.map((m) => m.timestamp));
      const pendingContent = newMessages.map((m) => `[Queued message]: ${m.content}`).join('\n\n');

      messages.push({
        role: MessageRole.USER,
        content: pendingContent,
        traceId,
        messageId: `msg-injected-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      });

      for (const m of newMessages) {
        if (m.attachments && m.attachments.length > 0) {
          attachments.push(...m.attachments);
        }
      }

      const processedIds = newMessages.map((m) => m.id);
      await sessionStateManager.renewProcessing(sessionId, agentId);
      await sessionStateManager.clearPendingMessages(sessionId, processedIds);
      logger.info(`[EXECUTOR] ${processedIds.length} pending messages cleared`);

      return maxTimestamp;
    }

    return lastInjectedMessageTimestamp;
  }

  /**
   * Checks for Lambda or custom task timeouts.
   */
  static checkTimeouts(
    startTime: number,
    taskTimeoutMs?: number,
    timeoutBehavior: 'pause' | 'fail' | 'continue' = 'pause',
    context?: LambdaContext
  ): { responseText: string; paused?: boolean; pauseMessage?: string } | null {
    // 1. Lambda Timeout
    if (context && typeof context.getRemainingTimeInMillis === 'function') {
      const remainingTime = context.getRemainingTimeInMillis();
      if (remainingTime < AGENT_DEFAULTS.TIMEOUT_BUFFER_MS) {
        logger.info(AGENT_LOG_MESSAGES.TIMEOUT_APPROACHING, { remainingTime });
        return {
          responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
          paused: true,
          pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
        };
      }
    }

    // 2. Custom Task Timeout
    if (taskTimeoutMs && taskTimeoutMs > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed > taskTimeoutMs) {
        logger.warn(`Task timeout exceeded: ${elapsed}ms > ${taskTimeoutMs}ms.`);
        if (timeoutBehavior === 'fail') {
          return { responseText: `TASK_FAILED: Execution timed out after ${taskTimeoutMs}ms.` };
        } else if (timeoutBehavior === 'pause') {
          return {
            responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
            paused: true,
            pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
          };
        }
      }
    }

    return null;
  }

  /**
   * Checks if the task has been cancelled.
   */
  static async checkCancellation(taskId: string): Promise<string | null> {
    try {
      const { isTaskCancelled } = await import('../../handlers/events/cancellation-handler');
      if (await isTaskCancelled(taskId)) {
        logger.info(`Task execution cancelled: ${taskId}`);
        return `TASK_CANCELLED: This task has been cancelled by the user or an initiator agent.`;
      }
    } catch (e) {
      logger.warn('Failed to check task cancellation status, proceeding:', e);
    }
    return null;
  }

  /**
   * Formats technical signaling from tool results for user display.
   */
  static formatUserFriendlyResponse(text: string): string {
    return text
      .replace(/^TASK_PAUSED:\s*/i, '')
      .replace(/\s*\(Trace: [^)]+\)\.?$/i, '')
      .trim();
  }

  /**
   * Formats a user-friendly message asking for tool execution approval.
   */
  static formatApprovalMessage(toolName: string, callId: string): string {
    return `I am requesting approval to execute the high-risk tool **${toolName}**. 
    
    Please review the planned action and reply with "Approve" or use the button below to proceed. (Call ID: ${callId})`;
  }

  /**
   * Checks for token or cost budget exhaustion.
   *
   * @param totalTokens - Current cumulative token usage.
   * @param tokenBudget - Maximum tokens allowed for the entire task.
   * @param costLimit - Maximum cost allowed for the entire task (USD).
   * @param activeProvider - The LLM provider name for cost estimation.
   * @param activeModel - The LLM model ID for cost estimation.
   * @returns A pause/failure result if budget is exceeded, a warning if approaching limit, null otherwise.
   */
  static checkBudgets(
    totalTokens: number,
    tokenBudget?: number,
    costLimit?: number,
    activeProvider?: string,
    activeModel?: string
  ): {
    responseText: string;
    paused?: boolean;
    pauseMessage?: string;
    isWarning?: boolean;
  } | null {
    const SOFT_LIMIT_THRESHOLD = 0.8;

    if (tokenBudget && tokenBudget > 0) {
      const usageRatio = totalTokens / tokenBudget;

      if (totalTokens > tokenBudget) {
        const budgetExceededMsg = `[BUDGET_EXCEEDED] Token budget of ${tokenBudget} exceeded. Current usage: ${totalTokens}. Stopping execution to prevent runaway costs.`;
        logger.warn(budgetExceededMsg);
        return {
          responseText: budgetExceededMsg,
          paused: false,
        };
      }

      if (usageRatio >= SOFT_LIMIT_THRESHOLD) {
        const warningMsg = `[BUDGET_WARNING] Token usage at ${Math.round(usageRatio * 100)}% of budget (${totalTokens}/${tokenBudget}). Wrapping up soon.`;
        logger.warn(warningMsg);
        return {
          responseText: warningMsg,
          paused: false,
          isWarning: true,
        };
      }
    }

    if (costLimit && costLimit > 0 && activeProvider && activeModel) {
      const estimatedCost = ExecutorHelper.estimateCost(totalTokens, activeProvider, activeModel);
      if (estimatedCost > costLimit) {
        const costExceededMsg = `[COST_LIMIT_EXCEEDED] Cost limit of $${costLimit.toFixed(2)} exceeded. Estimated cost: $${estimatedCost.toFixed(2)}. Stopping execution.`;
        logger.warn(costExceededMsg);
        return {
          responseText: costExceededMsg,
          paused: false,
        };
      }

      const costRatio = estimatedCost / costLimit;
      if (costRatio >= SOFT_LIMIT_THRESHOLD) {
        const costWarningMsg = `[COST_WARNING] Cost at ${Math.round(costRatio * 100)}% of limit ($${estimatedCost.toFixed(2)}/$${costLimit.toFixed(2)}). Wrapping up soon.`;
        logger.warn(costWarningMsg);
        return {
          responseText: costWarningMsg,
          paused: false,
          isWarning: true,
        };
      }
    }

    return null;
  }

  /**
   * Estimates USD cost for token usage based on provider/model pricing.
   * Uses conservative default rates when exact pricing is unavailable.
   */
  private static estimateCost(totalTokens: number, provider: string, model: string): number {
    const pricing: Record<string, Record<string, { input: number; output: number }>> = {
      openai: {
        'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
        'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
        o3: { input: 10 / 1_000_000, output: 40 / 1_000_000 },
        'o3-mini': { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
      },
      anthropic: {
        'claude-sonnet-4-20250514': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
        'claude-opus-4-20250514': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
        'claude-haiku-3-5-20241022': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
      },
      google: {
        'gemini-2.5-pro': { input: 1.25 / 1_000_000, output: 10 / 1_000_000 },
        'gemini-2.5-flash': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
      },
    };

    const modelPricing = pricing[provider]?.[model];
    if (modelPricing) {
      const avgRate = (modelPricing.input + modelPricing.output) / 2;
      return totalTokens * avgRate;
    }

    const DEFAULT_RATE_PER_MILLION = 3;
    return totalTokens * (DEFAULT_RATE_PER_MILLION / 1_000_000);
  }
}
