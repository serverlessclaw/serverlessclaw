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
import { MCP } from '../constants/tools';

function isToolExecutionSuccessful(rawResult: ToolResult | string, resultText: string): boolean {
  if (resultText.startsWith('FAILED')) return false;
  if (typeof rawResult === 'object' && rawResult !== null) {
    const res = rawResult as any;
    if (res.success === false) return false;
    if (res.error) return false;
    if (res.status === 'error' || res.status === 'failed') return false;
  }
  return true;
}

export interface ToolExecutionContext {
  traceId: string;
  nodeId: string;
  parentId?: string;
  agentId: string;
  agentName: string;
  currentInitiator: string;
  depth: number;
  sessionId?: string;
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
  staffId?: string;
  userId: string;
  /** User role for RBAC enforcement. */
  userRole?: import('../types/agent').UserRole;
  metadata?: Record<string, unknown>;
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
    // Use agentConfig.parallelToolCalls if available, defaulting to false for safety
    const enableParallel = execContext.agentConfig?.parallelToolCalls ?? false;
    const toolInfos = toolCalls.map((tc) => {
      const tool = availableTools.find((t) => t.name === tc.function.name);
      return { toolCall: tc, tool };
    });

    const hasSequential = toolInfos.some((ti) => ti.tool?.sequential);

    // If parallel is disabled, or we have sequential tools, or only one tool, keep original sequential behavior
    if (!enableParallel || hasSequential || toolCalls.length <= 1) {
      for (const toolCall of toolCalls) {
        const tool = availableTools.find((t) => t.name === toolCall.function.name);
        const result = await this.executeSingleToolCall(
          toolCall,
          tool,
          messages,
          attachments,
          execContext,
          tracer,
          approvedToolCalls
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
        const localSteps: any[] = [];

        const result = await this.executeSingleToolCall(
          toolCall,
          tool,
          localMessages,
          localAttachments,
          execContext,
          tracer,
          approvedToolCalls,
          localSteps
        );

        return { result, localMessages, localAttachments, localSteps };
      })
    );

    // Merge results in original order
    const allBatchedSteps: any[] = [];
    for (const res of parallelResults) {
      if (res.result.ui_blocks) ui_blocks.push(...res.result.ui_blocks);
      if (res.result.toolCallCount) toolCallCount += res.result.toolCallCount;

      messages.push(...res.localMessages);
      attachments.push(...res.localAttachments);
      allBatchedSteps.push(...res.localSteps);

      // If any tool paused, we should probably stop and return.
      // Note: in parallel mode, some tools might have already finished.
      // Collect any pending side effects from completed tools before returning
      if (res.result.paused) {
        // Even if paused, we emit the steps we collected so far
        await tracer.batchAddSteps(allBatchedSteps);

        logger.warn(
          `[EXECUTOR] Parallel execution paused by tool ${res.result.responseText} (WS: ${execContext.workspaceId || 'global'}). ${toolCalls.length - parallelResults.indexOf(res) - 1} tool(s) may still be in-flight.`
        );
        return {
          ...res.result,
          toolCallCount,
          ui_blocks: ui_blocks.length > 0 ? ui_blocks : undefined,
        };
      }
    }

    // Flush all parallel steps in a single atomic update
    await tracer.batchAddSteps(allBatchedSteps);

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
    stepCollector?: any[]
  ): Promise<{
    paused?: boolean;
    responseText?: string;
    asyncWait?: boolean;
    toolCallCount: number;
    ui_blocks?: Message['ui_blocks'];
  }> {
    const addStep = async (step: any) => {
      if (stepCollector) {
        stepCollector.push(step);
      } else {
        await tracer.addStep(step);
      }
    };
    if (!tool) {
      logger.info(`Tool ${toolCall.function.name} requested but no local implementation found.`);
      messages.push({
        role: MessageRole.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: 'EXECUTED_BY_PROVIDER',
        traceId: execContext.traceId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        workspaceId: execContext.workspaceId,
      });

      // Record failure if no implementation found (Anti-Pattern 13: Blind Tool Failure)
      try {
        const { TrustManager } = await import('../safety/trust-manager');
        await TrustManager.recordFailure(
          execContext.agentId,
          `Tool ${toolCall.function.name} requested but not found in registry.`,
          1.5, // Penalty for hallucinating missing tools
          0,
          {
            workspaceId: execContext.workspaceId,
            teamId: execContext.teamId,
            staffId: execContext.staffId,
          }
        );
      } catch (e) {
        logger.error('[EXECUTOR] Failed to record missing tool failure:', e);
      }

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

      // Record JSON parsing failure as a trust penalty
      try {
        const { TrustManager } = await import('../safety/trust-manager');
        await TrustManager.recordFailure(
          execContext.agentId,
          `Tool ${tool.name} failed: Malformed JSON arguments`,
          1,
          0,
          {
            workspaceId: execContext.workspaceId,
            teamId: execContext.teamId,
            staffId: execContext.staffId,
          }
        );
      } catch (trustError) {
        logger.error('[EXECUTOR] Failed to record parsing failure:', trustError);
      }

      return { toolCallCount: 0 };
    }

    // 1.5 Security Validation
    const { ToolSecurityValidator } = await import('./tool-security');
    let securityResult: {
      allowed: boolean;
      requiresApproval?: boolean;
      reason?: string;
      modifiedArgs?: Record<string, unknown>;
    };
    try {
      securityResult = await ToolSecurityValidator.validate(
        tool,
        toolCall,
        args,
        execContext,
        approvedToolCalls
      );
    } catch (secError) {
      logger.error(`[SECURITY] Validator crashed (failing closed) for ${tool.name}:`, secError);
      securityResult = {
        allowed: false,
        reason: `System safety block active due to an internal security check failure: ${secError instanceof Error ? secError.message : String(secError)}`,
      };
    }

    if (!securityResult.allowed) {
      if (securityResult.requiresApproval) {
        return {
          asyncWait: true,
          toolCallCount: 0,
          paused: true,
          responseText: securityResult.reason,
        };
      }

      messages.push({
        role: MessageRole.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: `FAILED: ${securityResult.reason}`,
        traceId: execContext.traceId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      });

      // Record security violation as a heavy trust penalty
      try {
        const { TrustManager } = await import('../safety/trust-manager');
        await TrustManager.recordFailure(
          execContext.agentId,
          `Security block: ${securityResult.reason} on tool ${tool.name}`,
          5, // Higher penalty for security violations
          0,
          {
            workspaceId: execContext.workspaceId,
            teamId: execContext.teamId,
            staffId: execContext.staffId,
          }
        );
      } catch (e) {
        logger.error('[EXECUTOR] Failed to record security failure:', e);
      }

      return { toolCallCount: 0 };
    }

    if (securityResult.modifiedArgs) {
      args = securityResult.modifiedArgs;
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
      workspaceId: execContext.workspaceId,
      teamId: execContext.teamId,
      staffId: execContext.staffId,
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
    args.workspaceId = args.workspaceId ?? execContext.workspaceId;
    args.teamId = args.teamId ?? execContext.teamId;
    args.staffId = args.staffId ?? execContext.staffId;

    // 2.5 Structural Enforcement (Zod Validation)
    if (tool.argSchema) {
      try {
        args = tool.argSchema.parse(args) as Record<string, unknown>;
      } catch (schemaError) {
        logger.error(`Argument validation failed for tool ${tool.name}:`, schemaError);
        const errMsg = schemaError instanceof Error ? schemaError.message : String(schemaError);
        messages.push({
          role: MessageRole.TOOL,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: `FAILED: Argument validation error: ${errMsg}`,
          traceId: execContext.traceId,
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        });

        // Record schema validation failure as a trust penalty
        try {
          const { TrustManager } = await import('../safety/trust-manager');
          await TrustManager.recordFailure(
            execContext.agentId,
            `Tool ${tool.name} failed: Argument validation error: ${errMsg}`,
            1,
            0,
            {
              workspaceId: execContext.workspaceId,
              teamId: execContext.teamId,
              staffId: execContext.staffId,
            }
          );
        } catch (trustError) {
          logger.error('[EXECUTOR] Failed to record validation failure:', trustError);
        }

        return { toolCallCount: 0 };
      }
    }

    // 3. Execution with timeout
    logger.info(
      `[EXECUTOR] Calling tool: ${tool.name} | Args: ${JSON.stringify(args).substring(0, 100)}`
    );
    await addStep({
      type: TRACE_TYPES.TOOL_CALL,
      content: { toolName: tool.name, args },
    });

    const toolStart = performance.now();
    const timeoutMs = parseInt(
      process.env.TOOL_EXECUTION_TIMEOUT_MS ?? String(MCP.TOOL_EXECUTION_TIMEOUT_MS)
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool execution timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    let rawResult: ToolResult | string;
    try {
      rawResult = await Promise.race([tool.execute(args), timeoutPromise]);
    } catch (execError) {
      logger.error(`[EXECUTOR] Tool ${tool.name} failed:`, execError);
      messages.push({
        role: MessageRole.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: `FAILED: Tool execution failed - ${execError instanceof Error ? execError.message : String(execError)}`,
        traceId: execContext.traceId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      });

      // Record execution crash as a trust penalty
      try {
        const { TrustManager } = await import('../safety/trust-manager');
        await TrustManager.recordFailure(
          execContext.agentId,
          `Tool ${tool.name} crashed: ${execError instanceof Error ? execError.message : String(execError)}`,
          2, // Medium penalty for crashes
          0,
          {
            workspaceId: execContext.workspaceId,
            teamId: execContext.teamId,
            staffId: execContext.staffId,
          }
        );
      } catch (e) {
        logger.error('[EXECUTOR] Failed to record execution failure:', e);
      }

      return { toolCallCount: 0 };
    }
    const toolDurationMs = performance.now() - toolStart;

    const resultText =
      typeof rawResult === 'string'
        ? rawResult
        : (rawResult as ToolResult).text || JSON.stringify(rawResult) || '';

    const toolSuccess = isToolExecutionSuccessful(rawResult, resultText);
    logger.info(`[EXECUTOR] Tool Result: ${tool.name} | Success: ${toolSuccess}`);

    // Update Trust Score (Principle 9/10: Autonomous Evolution)
    try {
      const { TrustManager } = await import('../safety/trust-manager');
      const trustContext = {
        workspaceId: execContext.workspaceId,
        teamId: execContext.teamId,
        staffId: execContext.staffId,
      };

      if (toolSuccess) {
        await TrustManager.recordSuccess(execContext.agentId, 10, trustContext);
      } else {
        await TrustManager.recordFailure(
          execContext.agentId,
          `Tool ${tool.name} execution failed.`,
          1,
          0,
          trustContext
        );
      }
    } catch (trustError) {
      logger.error('[EXECUTOR] Failed to update trust score:', trustError);
      try {
        const { reportHealthIssue } = await import('../lifecycle/health');
        await reportHealthIssue({
          component: 'TrustManager',
          issue: `Trust update failed for ${execContext.agentId}. Persistence layer may be unstable.`,
          severity: 'medium',
          userId: execContext.userId,
        });
      } catch {
        // Ignore secondary health reporting failures
      }
    }

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
      await AgentRegistry.recordToolUsage(tool.name, execContext.agentId, {
        workspaceId: execContext.workspaceId,
        teamId: execContext.teamId,
        staffId: execContext.staffId,
      });
      const estimatedInputTokens = Math.ceil(JSON.stringify(args).length / 4);
      const estimatedOutputTokens = Math.ceil(resultText.length / 4);

      try {
        const { emitMetrics, METRICS } = await import('../metrics');
        const scope = {
          workspaceId: execContext.workspaceId,
          teamId: execContext.teamId,
          staffId: execContext.staffId,
        };
        emitMetrics([METRICS.toolExecuted(tool.name, toolSuccess, scope)]).catch(() => {});
        emitMetrics([METRICS.toolDuration(tool.name, Math.round(toolDurationMs), scope)]).catch(
          () => {}
        );

        const { TokenTracker } = await import('../metrics/token-usage');
        TokenTracker.updateToolRollup(
          tool.name,
          toolSuccess,
          Math.round(toolDurationMs),
          estimatedInputTokens,
          estimatedOutputTokens,
          scope
        ).catch(() => {});

        // Phase 16: Evolution Analytics (Tool ROI)
        const { EVOLUTION_METRICS } = await import('../metrics/evolution-metrics');
        EVOLUTION_METRICS.recordToolExecution(tool.name, toolSuccess, Math.round(toolDurationMs), {
          workspaceId: execContext.workspaceId,
          orgId: execContext.orgId,
          teamId: execContext.teamId,
          staffId: execContext.staffId,
        });

        // Simple cost estimation for ROI (tokens as proxy)
        const totalTokens = estimatedInputTokens + estimatedOutputTokens;
        const estimatedValue = toolSuccess ? 1.0 : 0.0;
        EVOLUTION_METRICS.recordToolROI(tool.name, estimatedValue, totalTokens, {
          workspaceId: execContext.workspaceId,
          orgId: execContext.orgId,
          teamId: execContext.teamId,
          staffId: execContext.staffId,
        });
      } catch {
        // Ignore metrics errors
      }
    }

    await addStep({
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
}
