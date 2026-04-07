import {
  ToolCall,
  ITool,
  Message,
  MessageRole,
  ToolResult,
  AttachmentType,
  isValidAttachment,
} from '../types/index';
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
    ui_blocks?: Message['ui_blocks'];
  }> {
    let toolCallCount = 0;
    const ui_blocks: NonNullable<Message['ui_blocks']> = [];

    for (const toolCall of toolCalls) {
      const tool = availableTools.find((t) => t.name === toolCall.function.name);

      if (!tool) {
        logger.info(`Tool ${toolCall.function.name} requested but no local implementation found.`);
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: 'EXECUTED_BY_PROVIDER',
          traceId: execContext.traceId,
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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

      // 1.5 RBAC Check
      if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
        let hasPermission;
        try {
          const { BaseMemoryProvider } = await import('../memory/base');
          const { IdentityManager } = await import('../session/identity');
          const identity = new IdentityManager(new BaseMemoryProvider());
          // System-initiated calls bypass RBAC
          if (!execContext.userId || execContext.userId === 'SYSTEM') {
            hasPermission = true;
          } else {
            hasPermission = true;
            for (const perm of tool.requiredPermissions) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Permission enum vs string[]
              const hasPerm = await identity.hasPermission(execContext.userId, perm as any);
              if (!hasPerm) {
                hasPermission = false;
                break;
              }
            }
          }
        } catch (error) {
          logger.error(`RBAC check failed for tool ${tool.name}:`, error);
          hasPermission = false;
        }

        if (!hasPermission) {
          logger.warn(`RBAC validation failed for user ${execContext.userId} on tool ${tool.name}`);
          messages.push({
            role: MessageRole.TOOL,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: `FAILED: Unauthorized. You do not have the required permissions (${tool.requiredPermissions.join(', ')}) to execute this tool.`,
            traceId: execContext.traceId,
            messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          });
          continue;
        }
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
            traceId: execContext.traceId,
            messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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

      // 4. Attachments & UI Blocks Collection
      if (typeof rawResult !== 'string') {
        const res = rawResult as ToolResult;
        if (res.images && res.images.length > 0) {
          for (const img of res.images) {
            attachments.push({ type: AttachmentType.IMAGE, base64: img });
          }
        }
        if (res.ui_blocks && res.ui_blocks.length > 0) {
          ui_blocks.push(...res.ui_blocks);
        }
        if (res.metadata?.attachments && Array.isArray(res.metadata.attachments)) {
          const metaAttachments = res.metadata.attachments as unknown[];
          for (const rawAtt of metaAttachments) {
            if (isValidAttachment(rawAtt)) {
              attachments.push(rawAtt as NonNullable<Message['attachments']>[number]);
            } else {
              logger.warn(`[EXECUTOR] Skipping invalid attachment from tool ${tool.name}`);
            }
          }
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
        traceId: execContext.traceId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      });

      // 6. Pause Signaling
      if (resultText.startsWith('TASK_PAUSED')) {
        return {
          responseText: resultText,
          paused: true,
          asyncWait: true,
          toolCallCount,
          ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined,
        };
      }
    }

    return { toolCallCount, ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined };
  }
}
