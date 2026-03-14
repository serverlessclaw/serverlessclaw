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
 */
export class AgentExecutor {
  constructor(
    private provider: IProvider,
    private tools: ITool[],
    private agentId: string,
    private agentName: string
  ) {}

  /**
   * Runs the core reasoning loop.
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
    }
  ): Promise<{
    responseText: string;
    paused?: boolean;
    pauseMessage?: string;
    attachments?: any[];
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
    } = options;

    let iterations = 0;
    let responseText = '';
    const attachments: any[] = [];

    while (iterations < maxIterations) {
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
      try {
        const capabilities = await this.provider.getCapabilities(activeModel);
        normalizedProfile = normalizeProfile(activeProfile, capabilities, activeModel || 'default');
      } catch (e) {
        logger.warn('Failed to fetch capabilities, using requested profile:', e);
      }

      const aiResponse = await this.provider.call(
        messages,
        this.tools,
        normalizedProfile,
        activeModel,
        activeProvider
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
          if (tool) {
            const args = JSON.parse(toolCall.function.arguments);
            // Context injection
            Object.assign(args, {
              traceId,
              nodeId,
              parentId,
              initiatorId: currentInitiator,
              depth,
              sessionId,
              userId: args.userId || userId,
              mainConversationId,
              agentName: this.agentName,
              activeModel,
              activeProvider,
              task: userText,
            });

            await tracer.addStep({ type: 'tool_call', content: { toolName: tool.name, args } });

            const rawResult = await tool.execute(args);
            const resultText =
              typeof rawResult === 'string'
                ? rawResult
                : (rawResult as ToolResult).text || JSON.stringify(rawResult) || '';

            // Collect attachments from result
            if (typeof rawResult !== 'string') {
              const res = rawResult as ToolResult;
              if (res.images && res.images.length > 0) {
                for (const img of res.images) {
                  attachments.push({ type: 'image', base64: img });
                }
              }
              if (res.metadata?.attachments && Array.isArray(res.metadata.attachments)) {
                attachments.push(...res.metadata.attachments);
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
        responseText = aiResponse.content || '';
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
      responseText: responseText || 'Sorry, I reached my iteration limit.',
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }
}
