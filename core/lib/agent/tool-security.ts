import { getSafetyEngine, getCircuitBreaker } from '../safety';
import { Permission } from '../session/identity';
import { ITool, ToolCall } from '../types/index';
import { logger } from '../logger';
import type { ToolExecutionContext } from './tool-executor';

export class ToolSecurityValidator {
  static async validate(
    tool: ITool,
    toolCall: ToolCall,
    args: Record<string, unknown>,
    execContext: ToolExecutionContext,
    approvedToolCalls?: string[]
  ): Promise<{
    allowed: boolean;
    reason?: string;
    requiresApproval?: boolean;
    modifiedArgs?: Record<string, unknown>;
  }> {
    // 1. Evolution Context & Fingerprint
    const { EvolutionMode } = await import('../types/agent');
    const evolutionMode = execContext.agentConfig?.evolutionMode ?? EvolutionMode.HITL;

    const { createHash } = await import('crypto');
    const toolCallFingerprint = createHash('sha256')
      .update(`${toolCall.function.name}:${toolCall.function.arguments}`)
      .digest('hex');

    // 2. Safety Engine Evaluation (use singleton)
    const safety = getSafetyEngine();
    const resourcePath = (args.path ||
      args.filePath ||
      args.resource ||
      args.destination ||
      args.source) as string | undefined;

    const safetyAction = tool.safetyAction || tool.name;
    const safetyResult = await safety.evaluateAction(execContext.agentConfig, safetyAction, {
      toolName: tool.name,
      resource: resourcePath,
      traceId: execContext.traceId,
      userId: execContext.userId,
      args,
      pathKeys: tool.pathKeys,
    });

    // 3. Circuit Breaker Check
    const cb = getCircuitBreaker();
    const cbResult = await cb.canProceed('autonomous');
    if (!cbResult.allowed) {
      logger.error(`[EXECUTOR] System Circuit Breaker is OPEN: ${cbResult.reason}`);
      return {
        allowed: false,
        reason: `System-level safety block active (Circuit Breaker OPEN). ${cbResult.reason}`,
      };
    }

    const isApproved =
      approvedToolCalls?.includes(toolCall.id) || approvedToolCalls?.includes(toolCallFingerprint);

    // Hard block check
    if (!safetyResult.allowed && !isApproved) {
      logger.warn(
        `[SECURITY] Action blocked for agent '${execContext.agentId}': ${safetyResult.reason}`
      );
      return { allowed: false, reason: `PERMISSION_DENIED - ${safetyResult.reason}` };
    }

    const requiresApproval = safetyResult.requiresApproval || tool.requiresApproval;
    const safetyAllowsInAutoMode = evolutionMode === EvolutionMode.AUTO && safetyResult.allowed;
    const effectiveApproved = isApproved || (safetyAllowsInAutoMode && !tool.requiresApproval);

    // Self-approval block
    if (args.manuallyApproved === true && !effectiveApproved) {
      logger.warn(
        `[SECURITY] Agent '${execContext.agentId}' attempted to self-approve tool '${tool.name}'.`
      );
      return {
        allowed: false,
        reason: `PERMISSION_DENIED - Self-approval is not allowed for this tool in current mode.`,
      };
    }

    if (requiresApproval && !effectiveApproved) {
      logger.info(
        `Tool ${tool.name} requires human approval. Reason: ${safetyResult.reason}. Pausing...`
      );
      return { allowed: false, requiresApproval: true, reason: safetyResult.reason };
    }

    // 4. RBAC Check
    if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
      let hasPermission = false;
      try {
        const { BaseMemoryProvider } = await import('../memory/base');
        const { IdentityManager } = await import('../session/identity');
        const identity = new IdentityManager(new BaseMemoryProvider());

        if (!execContext.userId || execContext.userId === 'SYSTEM') {
          hasPermission = true;
        } else {
          for (const perm of tool.requiredPermissions) {
            hasPermission = await identity.hasPermission(
              execContext.userId,
              perm as Permission,
              execContext.workspaceId
            );
            if (!hasPermission) break;
          }
        }
      } catch (error) {
        logger.error(`RBAC check failed for tool ${tool.name}:`, error);
      }

      if (!hasPermission) {
        logger.warn(`RBAC validation failed for user ${execContext.userId} on tool ${tool.name}`);
        return {
          allowed: false,
          reason: `Unauthorized. You do not have the required permissions (${tool.requiredPermissions.join(', ')}) to execute this tool.`,
        };
      }
    }

    // Apply auto-approval flag logic
    const modifiedArgs = { ...args };
    if (evolutionMode === EvolutionMode.AUTO || effectiveApproved) {
      if (modifiedArgs.manuallyApproved !== true && safetyResult.allowed) {
        logger.info(
          `[SECURITY] Activating 'manuallyApproved: true' for tool ${tool.name} (AUTO/Approved mode and safety cleared).`
        );
        modifiedArgs.manuallyApproved = true;
      }
    } else if (modifiedArgs.manuallyApproved === true && !isApproved) {
      logger.warn(
        `[SECURITY] Agent attempted self-approval of protected resource in tool ${tool.name} (HITL mode). Blocked.`
      );
      modifiedArgs.manuallyApproved = false;
    }

    return { allowed: true, modifiedArgs };
  }
}
