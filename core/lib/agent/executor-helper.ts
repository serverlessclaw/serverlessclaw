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
    sessionStateManager: import('../session/session-state').SessionStateManager
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
      });

      for (const m of newMessages) {
        if (m.attachments && m.attachments.length > 0) {
          attachments.push(...m.attachments);
        }
      }

      const processedIds = newMessages.map((m) => m.id);
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
}
