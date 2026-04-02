import { ToolCall, ITool, Message, MessageRole, ToolResult, AttachmentType } from '../types/index';
import { logger } from '../logger';
import { AgentRegistry } from '../registry';
import { ClawTracer } from '../tracer';
import { TRACE_TYPES } from '../constants';

export interface ToolExecutionContext {
  traceId: string;
  nodeId: string;
  parentId?: string;
  agentId: string;
  agentName: string;
  currentInitiator: string;
  depth: number;
  sessionId?: string;
  userId: string;
  mainConversationId: string;
  activeModel?: string;
  activeProvider?: string;
  userText: string;
}

export class ToolExecutor {
  /**
   * Executes a list of tool calls and appends results to messages.
   */
  static async executeToolCalls(
    toolCalls: ToolCall[],
    availableTools: ITool[],
    messages: Message[],
    attachments: NonNullable<Message['attachments']>,
    execContext: ToolExecutionContext,
    tracer: ClawTracer,
    approvedToolCalls?: string[]
  ): Promise<{
    paused?: boolean;
    responseText?: string;
    asyncWait?: boolean;
    toolCallCount: number;
  }> {
    let toolCallCount = 0;

    for (const toolCall of toolCalls) {
      const tool = availableTools.find((t) => t.name === toolCall.function.name);

      if (!tool) {
        logger.info(`Tool ${toolCall.function.name} requested but no local implementation found.`);
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: 'EXECUTED_BY_PROVIDER',
        });
        continue;
      }

      // 1. Approval Check
      if (tool.requiresApproval && !approvedToolCalls?.includes(toolCall.id)) {
        logger.info(`Tool ${tool.name} (ID: ${toolCall.id}) requires human approval. Pausing...`);
        return {
          asyncWait: true,
          toolCallCount,
          paused: true,
          // Note: responseText and other UI fields are handled by caller for more flexibility
        };
      }

      // 2. Argument Preparation & Context Injection
      let args = JSON.parse(toolCall.function.arguments);
      const contextArgs: Record<string, unknown> = {
        traceId: execContext.traceId,
        nodeId: execContext.nodeId,
        parentId: execContext.parentId,
        executorAgentId: execContext.agentId,
        executorAgentName: execContext.agentName,
        initiatorId: execContext.currentInitiator,
        depth: execContext.depth,
        sessionId: execContext.sessionId,
        mainConversationId: execContext.mainConversationId,
        activeModel: execContext.activeModel,
        activeProvider: execContext.activeProvider,
        originalUserTask: execContext.userText,
      };

      Object.entries(contextArgs).forEach(([key, value]) => {
        if (args[key] === undefined) {
          args[key] = value;
        }
      });
      args.userId = args.userId ?? execContext.userId;
      args.sessionId = args.sessionId ?? execContext.sessionId;

      // 2.5 Structural Enforcement (Zod Validation)
      if (tool.argSchema) {
        try {
          args = tool.argSchema.parse(args);
        } catch (schemaError) {
          logger.error(`Argument validation failed for tool ${tool.name}:`, schemaError);
          messages.push({
            role: MessageRole.TOOL,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: `FAILED: Argument validation error: ${schemaError instanceof Error ? schemaError.message : String(schemaError)}`,
          });
          continue;
        }
      }

      // 3. Execution
      logger.info(
        `[EXECUTOR] Calling tool: ${tool.name} | Args: ${JSON.stringify(args).substring(0, 100)}`
      );
      await tracer.addStep({
        type: TRACE_TYPES.TOOL_CALL,
        content: { toolName: tool.name, args },
      });

      const toolStart = performance.now();
      const rawResult = await tool.execute(args);
      const toolDurationMs = performance.now() - toolStart;

      const resultText =
        typeof rawResult === 'string'
          ? rawResult
          : (rawResult as ToolResult).text || JSON.stringify(rawResult) || '';

      logger.info(
        `[EXECUTOR] Tool Result: ${tool.name} | Success: ${!resultText.startsWith('FAILED')}`
      );

      // 4. Attachments Collection
      if (typeof rawResult !== 'string') {
        const res = rawResult as ToolResult;
        if (res.images && res.images.length > 0) {
          for (const img of res.images) {
            attachments.push({ type: AttachmentType.IMAGE, base64: img });
          }
        }
        if (res.metadata?.attachments && Array.isArray(res.metadata.attachments)) {
          attachments.push(...(res.metadata.attachments as NonNullable<Message['attachments']>));
        }
      }

      // 5. Metrics & Registry
      if (!process.env.VITEST) {
        await AgentRegistry.recordToolUsage(tool.name, execContext.agentId);
        const toolSuccess = !resultText.startsWith('FAILED');
        const estimatedInputTokens = Math.ceil(JSON.stringify(args).length / 4);
        const estimatedOutputTokens = Math.ceil(resultText.length / 4);

        try {
          const { emitMetrics, METRICS } = await import('../metrics');
          emitMetrics([METRICS.toolExecuted(tool.name, toolSuccess)]).catch(() => {});

          const { TokenTracker } = await import('../metrics/token-usage');
          TokenTracker.updateToolRollup(
            tool.name,
            toolSuccess,
            Math.round(toolDurationMs),
            estimatedInputTokens,
            estimatedOutputTokens
          ).catch(() => {});
        } catch {
          // Ignore metrics errors
        }
      }

      toolCallCount++;

      await tracer.addStep({
        type: TRACE_TYPES.TOOL_RESULT,
        content: { toolName: tool.name, result: rawResult },
      });

      messages.push({
        role: MessageRole.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: resultText,
      });

      // 6. Pause Signaling
      if (resultText.startsWith('TASK_PAUSED')) {
        return {
          responseText: resultText,
          paused: true,
          asyncWait: true,
          toolCallCount,
        };
      }
    }

    return { toolCallCount };
  }
}
