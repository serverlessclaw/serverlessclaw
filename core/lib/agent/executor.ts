import {
  Message,
  ITool,
  IProvider,
  ReasoningProfile,
  MessageRole,
  ToolResult,
} from '../types/index';
import { logger } from '../logger';
import { AgentRegistry } from '../registry';
import { normalizeProfile } from '../providers/utils';
import { ClawTracer } from '../tracer';
import { LIMITS } from '../constants';
import { ContextManager } from './context-manager';
import { Context as LambdaContext } from 'aws-lambda';

export const AGENT_DEFAULTS = {
  MAX_ITERATIONS: 25,
  REFLECTION_FREQUENCY: 25,
  TIMEOUT_BUFFER_MS: 30000,
} as const;

export const AGENT_LOG_MESSAGES = {
  TIMEOUT_APPROACHING: 'Lambda timeout approaching, pausing task...',
  RECOVERY_LOG_PREFIX: '\n\nSYSTEM_RECOVERY_LOG: Recent emergency rollback occurred. Details: ',
  TASK_PAUSED_TIMEOUT:
    'TASK_PAUSED: I need more time to complete this. I have checkpointed my progress and am resuming in a fresh execution...',
  TASK_PAUSED_ITERATION_LIMIT:
    'TASK_PAUSED: This task is complex and requires multiple steps. I have reached my single-turn safety limit and am resuming in a fresh execution...',
} as const;

/**
 * Handles the iterative execution loop of an agent.
 * @since 2026-03-19
 */
export class AgentExecutor {
  // Track the timestamp of the last message we've already seen/injected
  // to avoid duplicates from history vs pending queue
  private lastInjectedMessageTimestamp: number = Date.now();

  constructor(
    private provider: IProvider,
    private tools: ITool[],
    private agentId: string,
    private agentName: string
  ) {}

  /**
   * Runs the core reasoning loop.
   *
   * @param messages - The initial array of messages for the conversation.
   * @param options - Execution options including model, provider, profile, and trace details.
   * @returns A promise resolving to the final response text and optional pause state/attachments.
   */
  async runLoop(
    messages: Message[],
    options: {
      activeModel?: string;
      activeProvider?: string;
      activeProfile: ReasoningProfile;
      maxIterations: number;
      tracer: ClawTracer;
      context?: LambdaContext;
      traceId: string;
      nodeId: string;
      parentId: string | undefined;
      currentInitiator: string;
      depth: number;
      sessionId?: string;
      userId: string;
      userText: string;
      mainConversationId: string;
      responseFormat?: import('../types/index').ResponseFormat;
      taskTimeoutMs?: number;
      timeoutBehavior?: 'pause' | 'fail' | 'continue';
      sessionStateManager?: import('../session-state').SessionStateManager;
    }
  ): Promise<{
    responseText: string;
    paused?: boolean;
    asyncWait?: boolean;
    pauseMessage?: string;
    attachments?: NonNullable<Message['attachments']>;
  }> {
    const {
      maxIterations,
      activeModel,
      activeProvider,
      activeProfile,
      tracer,
      context,
      traceId,
      nodeId,
      parentId,
      currentInitiator,
      depth,
      sessionId,
      userId,
      userText,
      mainConversationId,
      responseFormat,
      taskTimeoutMs,
      timeoutBehavior = 'pause',
      sessionStateManager,
    } = options;

    let iterations = 0;
    let responseText = '';
    const attachments: NonNullable<Message['attachments']> = [];

    console.log(`[EXECUTOR] Available Tools: ${this.tools.map((t) => t.name).join(', ')}`);

    // 0. Global Pause Check (Kill Switch)
    try {
      const { DYNAMO_KEYS } = await import('../constants');
      const isPaused = await AgentRegistry.getRawConfig(DYNAMO_KEYS.GLOBAL_PAUSE);
      if (isPaused === true) {
        logger.warn(`Agent execution blocked: GLOBAL_PAUSE is active.`);
        return {
          responseText:
            'SYSTEM_PAUSED: All autonomous agent activities have been globally suspended by the administrator. Please contact your system operator to resume operations.',
        };
      }
    } catch (e) {
      logger.error('Failed to check GLOBAL_PAUSE status, proceeding with caution:', e);
    }

    const startTime = Date.now();
    while (iterations < maxIterations) {
      // 0.5. Pending Message Check - Inject queued messages into context
      if (sessionStateManager && sessionId) {
        const pendingMessages = await sessionStateManager.getPendingMessages(sessionId);

        // Filter out messages we've already seen or that are too old (to avoid duplicates with initial history)
        const newMessages = pendingMessages.filter(
          (m) => m.timestamp > this.lastInjectedMessageTimestamp
        );

        if (newMessages.length > 0) {
          logger.info(
            `[EXECUTOR] Found ${newMessages.length} new pending messages, injecting into context`
          );

          // Update our high-water mark
          this.lastInjectedMessageTimestamp = Math.max(...newMessages.map((m) => m.timestamp));

          // Format pending messages as natural user messages
          const pendingContent = newMessages
            .map((m) => `[Queued message]: ${m.content}`)
            .join('\n\n');

          // Add pending messages to conversation
          messages.push({
            role: MessageRole.USER,
            content: pendingContent,
          });

          // Also collect attachments from pending messages
          for (const m of newMessages) {
            if (m.attachments && m.attachments.length > 0) {
              attachments.push(...m.attachments);
            }
          }

          // Clear ONLY the messages we just injected to avoid race conditions
          const processedIds = newMessages.map((m) => m.id);
          await sessionStateManager.clearPendingMessages(sessionId, processedIds);
          logger.info(
            `[EXECUTOR] ${processedIds.length} pending messages cleared, continuing with updated context`
          );
        }

        // Renew processing flag to prevent expiry during long tasks
        await sessionStateManager.renewProcessing(sessionId, this.agentId);
      }

      // 1. Timeout Check
      if (context && typeof context.getRemainingTimeInMillis === 'function') {
        const remainingTime = context.getRemainingTimeInMillis();
        if (remainingTime < AGENT_DEFAULTS.TIMEOUT_BUFFER_MS) {
          logger.info(AGENT_LOG_MESSAGES.TIMEOUT_APPROACHING, { remainingTime, iterations });
          return {
            responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
            paused: true,
            pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
            attachments,
          };
        }
      }

      // 1.1 Custom Task Timeout Check
      if (taskTimeoutMs && taskTimeoutMs > 0) {
        const elapsed = Date.now() - startTime;
        if (elapsed > taskTimeoutMs) {
          logger.warn(
            `Task timeout exceeded: ${elapsed}ms > ${taskTimeoutMs}ms. Behavior: ${timeoutBehavior}`
          );
          if (timeoutBehavior === 'fail') {
            return { responseText: `TASK_FAILED: Execution timed out after ${taskTimeoutMs}ms.` };
          } else if (timeoutBehavior === 'pause') {
            return {
              responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
              paused: true,
              pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_TIMEOUT,
              attachments,
            };
          }
          // 'continue' just falls through
        }
      }

      // 1.5 Context Size Safeguard
      const currentTokens = ContextManager.estimateTokens(messages);
      if (currentTokens > LIMITS.MAX_CONTEXT_LENGTH * 0.9) {
        logger.warn(
          `Approaching context limit in execution loop: ${currentTokens}/${LIMITS.MAX_CONTEXT_LENGTH}.`
        );
      }

      // 2. LLM Call
      await tracer.addStep({
        type: 'llm_call',
        content: {
          messageCount: messages.length,
          model: activeModel,
          provider: activeProvider,
        },
      });

      let normalizedProfile = activeProfile;
      let effectiveResponseFormat = undefined;
      try {
        const capabilities = await this.provider.getCapabilities(activeModel);
        normalizedProfile = normalizeProfile(activeProfile, capabilities, activeModel ?? 'default');
        if (capabilities.supportsStructuredOutput) {
          effectiveResponseFormat = responseFormat;
        }
      } catch (e) {
        logger.warn('Failed to fetch capabilities, using requested profile:', e);
      }

      const aiResponse = await this.provider.call(
        messages,
        this.tools,
        normalizedProfile,
        activeModel,
        activeProvider,
        effectiveResponseFormat
      );

      console.log(
        `[EXECUTOR] AI Response: ${aiResponse.content?.substring(0, 50)}... | Tools: ${aiResponse.tool_calls?.length ?? 0}`
      );

      await tracer.addStep({
        type: 'llm_response',
        content: {
          content: aiResponse.content,
          tool_calls: aiResponse.tool_calls,
          usage: aiResponse.usage,
        },
      });

      // 3. Tool Processing
      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        messages.push(aiResponse);

        for (const toolCall of aiResponse.tool_calls) {
          const tool = this.tools.find((t) => t.name === toolCall.function.name);
          console.log(`[EXECUTOR] Found tool ${toolCall.function.name}: ${!!tool}`);
          if (tool) {
            const args = JSON.parse(toolCall.function.arguments);
            // 2.2 Context injection (Safely merge system-provided context without overwriting LLM args)
            const contextArgs: Record<string, unknown> = {
              traceId,
              nodeId,
              parentId,
              executorAgentId: this.agentId,
              executorAgentName: this.agentName,
              initiatorId: currentInitiator,
              depth,
              sessionId,
              mainConversationId,
              activeModel,
              activeProvider,
              originalUserTask: userText,
            };

            // Safely populate args: only add if the tool didn't already provide it
            Object.entries(contextArgs).forEach(([key, value]) => {
              if (args[key] === undefined) {
                args[key] = value;
              }
            });

            // Ensure standard identifiers are present
            args.userId = args.userId ?? userId;
            args.sessionId = args.sessionId ?? sessionId;

            console.log(
              `[EXECUTOR] Calling tool: ${tool.name} | Args:`,
              JSON.stringify(args).substring(0, 100)
            );
            await tracer.addStep({ type: 'tool_call', content: { toolName: tool.name, args } });

            const rawResult = await tool.execute(args);
            const resultText =
              typeof rawResult === 'string'
                ? rawResult
                : (rawResult as ToolResult).text || JSON.stringify(rawResult) || '';
            console.log(
              `[EXECUTOR] Tool Result: ${tool.name} | Success: ${!resultText.startsWith('FAILED')}`
            );

            // Collect attachments from result
            if (typeof rawResult !== 'string') {
              const res = rawResult as ToolResult;
              if (res.images && res.images.length > 0) {
                for (const img of res.images) {
                  attachments.push({ type: 'image', base64: img });
                }
              }
              if (res.metadata?.attachments && Array.isArray(res.metadata.attachments)) {
                attachments.push(
                  ...(res.metadata.attachments as NonNullable<Message['attachments']>)
                );
              }
            }

            if (!process.env.VITEST) {
              await AgentRegistry.recordToolUsage(tool.name, this.agentId);
            }

            await tracer.addStep({
              type: 'tool_result',
              content: { toolName: tool.name, result: rawResult },
            });

            messages.push({
              role: MessageRole.TOOL,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: resultText,
            });

            // 4. HITL/Pause Optimization: Break loop immediately if tool returns TASK_PAUSED
            if (resultText.startsWith('TASK_PAUSED')) {
              return {
                responseText: aiResponse.content || this.formatUserFriendlyResponse(resultText),
                paused: true,
                asyncWait: true,
                pauseMessage: resultText,
                attachments,
              };
            }
          } else {
            logger.info(
              `Tool ${toolCall.function.name} requested but no local implementation found.`
            );
            messages.push({
              role: MessageRole.TOOL,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: 'EXECUTED_BY_PROVIDER',
            });
          }
        }
        iterations++;
      } else {
        responseText = aiResponse.content ?? '';
        break;
      }
    }

    if (!responseText && iterations >= maxIterations) {
      return {
        responseText: AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT,
        paused: true,
        pauseMessage: AGENT_LOG_MESSAGES.TASK_PAUSED_ITERATION_LIMIT,
        attachments,
      };
    }

    return {
      responseText: responseText ?? 'Sorry, I reached my iteration limit.',
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  /**
   * Cleans up technical signaling from tool results for user display.
   * Strips 'TASK_PAUSED:' and '(Trace: ...)' metadata.
   */
  private formatUserFriendlyResponse(text: string): string {
    return text
      .replace(/^TASK_PAUSED:\s*/i, '')
      .replace(/\s*\(Trace: [^)]+\)\.?$/i, '')
      .trim();
  }
}
