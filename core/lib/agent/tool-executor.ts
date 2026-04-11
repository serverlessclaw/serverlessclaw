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
  agentConfig?: import('../types/index').IAgentConfig;
}

export class ToolExecutor {
  /**
   * Executes a list of tool calls and appends results to messages.
   * Supports parallel execution unless a tool is marked as sequential.
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

    // 0. Pre-check: Determine if we can run in parallel
    const toolInfos = toolCalls.map((tc) => {
      const tool = availableTools.find((t) => t.name === tc.function.name);
      return { toolCall: tc, tool };
    });

    const hasSequential = toolInfos.some((ti) => ti.tool?.sequential);

    // If we have sequential tools, or only one tool, keep original sequential behavior for simplicity and safety
    if (hasSequential || toolCalls.length <= 1) {
      for (const toolCall of toolCalls) {
        const tool = availableTools.find((t) => t.name === toolCall.function.name);
        const result = await this.executeSingleToolCall(
          toolCall,
          tool,
          messages,
          attachments,
          execContext,
          tracer,
          approvedToolCalls,
          execContext.agentConfig
        );

        if (result.ui_blocks) ui_blocks.push(...result.ui_blocks);
        if (result.toolCallCount) toolCallCount += result.toolCallCount;

        if (result.paused) {
          return {
            ...result,
            toolCallCount,
            ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined,
          };
        }
      }
      return { toolCallCount, ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined };
    }

    // Parallel Execution Flow
    logger.info(`[EXECUTOR] Executing ${toolCalls.length} tools in parallel.`);

    const parallelResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const tool = availableTools.find((t) => t.name === toolCall.function.name);
        // We use local arrays for messages and attachments to avoid race conditions during parallel execution
        const localMessages: Message[] = [];
        const localAttachments: NonNullable<Message['attachments']> = [];

        const result = await this.executeSingleToolCall(
          toolCall,
          tool,
          localMessages,
          localAttachments,
          execContext,
          tracer,
          approvedToolCalls,
          execContext.agentConfig
        );

        return { result, localMessages, localAttachments };
      })
    );

    // Merge results in original order
    for (const res of parallelResults) {
      if (res.result.ui_blocks) ui_blocks.push(...res.result.ui_blocks);
      if (res.result.toolCallCount) toolCallCount += res.result.toolCallCount;

      messages.push(...res.localMessages);
      attachments.push(...res.localAttachments);

      // If any tool paused, we should probably stop and return.
      // Note: in parallel mode, some tools might have already finished.
      if (res.result.paused) {
        return {
          ...res.result,
          toolCallCount,
          ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined,
        };
      }
    }

    return { toolCallCount, ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined };
  }

  /**
   * Internal helper to execute a single tool call.
   * Extracted from the original loop to support both sequential and parallel modes.
   */
  private static async executeSingleToolCall(
    toolCall: ToolCall,
    tool: ITool | undefined,
    messages: Message[],
    attachments: NonNullable<Message['attachments']>,
    execContext: ToolExecutionContext,
    tracer: ClawTracer,
    approvedToolCalls?: string[],
    agentConfig?: import('../types/index').IAgentConfig
  ): Promise<{
    paused?: boolean;
    responseText?: string;
    asyncWait?: boolean;
    toolCallCount: number;
    ui_blocks?: Message['ui_blocks'];
  }> {
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
      return { toolCallCount: 0 };
    }

    // 1. Argument Preparation (Moved up for sensitivity detection)
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      logger.error(`Failed to parse arguments for tool ${tool.name}:`, e);
      messages.push({
        role: MessageRole.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: `FAILED: Malformed JSON arguments.`,
        traceId: execContext.traceId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      });
      return { toolCallCount: 0 };
    }

    // 1.5 Approval & Evolution Context
    const { EvolutionMode } = await import('../types/agent');
    const evolutionMode = agentConfig?.evolutionMode ?? EvolutionMode.HITL;

    // Support both ID and Semantic Fingerprint for manual approvals
    const { createHash } = await import('crypto');
    const toolCallFingerprint = createHash('sha256')
      .update(`${toolCall.function.name}:${toolCall.function.arguments}`)
      .digest('hex');

    // Centralized Sensitive Check
    const isSensitive = await this.isSensitiveTool(tool, toolCall, args);
    const requiresApproval = tool.requiresApproval || isSensitive;
    const requiredPermissions = isSensitive
      ? [...new Set([...(tool.requiredPermissions || []), 'admin'])]
      : tool.requiredPermissions || [];

    const isApproved =
      approvedToolCalls?.includes(toolCall.id) || approvedToolCalls?.includes(toolCallFingerprint);

    // If evolutionMode is AUTO, we treat it as approved unless it's explicitly blocked (Class D check happens in fs-security)
    const effectiveApproved = isApproved || evolutionMode === EvolutionMode.AUTO;

    if (requiresApproval && !effectiveApproved) {
      console.log(
        'PAUSING. requiresApproval:',
        requiresApproval,
        'effectiveApproved:',
        effectiveApproved,
        'isSensitive:',
        isSensitive
      );
      logger.info(
        `Tool ${tool.name} (Fingerprint: ${toolCallFingerprint}) requires human approval. Pausing...`
      );
      return {
        asyncWait: true,
        toolCallCount: 0,
        paused: true,
      };
    }

    // 1.5 RBAC Check
    if (requiredPermissions && requiredPermissions.length > 0) {
      let hasPermission = false;
      try {
        const { BaseMemoryProvider } = await import('../memory/base');
        const { IdentityManager } = await import('../session/identity');
        const identity = new IdentityManager(new BaseMemoryProvider());
        // System-initiated calls or AUTO mode (if system-owned) bypass initial RBAC
        if (!execContext.userId || execContext.userId === 'SYSTEM') {
          hasPermission = true;
        } else {
          for (const perm of requiredPermissions) {
            hasPermission = await identity.hasPermission(execContext.userId, perm as any);
            if (!hasPermission) {
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
          content: `FAILED: Unauthorized. You do not have the required permissions (${requiredPermissions.join(', ')}) to execute this tool.`,
          traceId: execContext.traceId,
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        });
        return { toolCallCount: 0 };
      }
    }

    // 2. Context Injection (Args already parsed)
    const { checkArgumentsForSecurity } = await import('../utils/fs-security');
    const isSecurityViolation = !!checkArgumentsForSecurity(
      args,
      `Security Pre-flight (${tool.name})`,
      tool.pathKeys
    );

    if (evolutionMode === EvolutionMode.AUTO || effectiveApproved) {
      if (args.manuallyApproved !== true && !isSecurityViolation) {
        logger.info(
          `[SECURITY] Activating 'manuallyApproved: true' for tool ${tool.name} (AUTO/Approved mode and no security violation).`
        );
        args.manuallyApproved = true;
      }
    } else if (args.manuallyApproved === true && !isApproved) {
      logger.warn(
        `[SECURITY] Agent attempted self-approval of protected resource in tool ${tool.name} (HITL mode). Blocked.`
      );
      args.manuallyApproved = false; // Block self-approval attempt in HITL/Default
    }

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

    // 2.2 Centralized File Security Check (G2)
    const securityError = checkArgumentsForSecurity(
      args,
      `Tool execution (${tool.name})`,
      tool.pathKeys
    );
    if (securityError) {
      logger.warn(`File security violation blocked for tool ${tool.name}: ${securityError}`);
      messages.push({
        role: MessageRole.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: securityError,
        traceId: execContext.traceId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      });
      return { toolCallCount: 0 };
    }

    // 2.5 Structural Enforcement (Zod Validation)
    if (tool.argSchema) {
      try {
        args = tool.argSchema.parse(args) as Record<string, unknown>;
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
        return { toolCallCount: 0 };
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

    const ui_blocks: Message['ui_blocks'] = [];

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
        toolCallCount: 1,
        ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined,
      };
    }

    return {
      toolCallCount: 1,
      ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined,
    };
  }

  /**
   * Helper to detect if a tool or tool call is sensitive based on names, descriptions, and arguments.
   */
  private static async isSensitiveTool(
    tool: ITool,
    toolCall: ToolCall,
    _args?: Record<string, unknown>
  ): Promise<boolean> {
    const sensitiveKeywords = [
      'aws',
      'delete',
      'remove',
      'terminate',
      'write',
      'update',
      'create',
      'put',
      'iam',
      'policy',
      'permission',
      'secret',
      'password',
      'token',
      'key',
      'grant',
      'revoke',
      'execute',
      'eval',
      'shell',
      'command',
      'drop',
      'truncate',
    ];

    const contentToCheck = [tool.name, tool.description, toolCall.function.name]
      .map((s) => (s ?? '').toLowerCase())
      .join(' ');

    return sensitiveKeywords.some((kw) => contentToCheck.includes(kw));
  }
}
