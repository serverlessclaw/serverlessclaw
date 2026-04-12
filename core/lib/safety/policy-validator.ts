import { SafetyTier, SafetyPolicy, TimeRestriction, SafetyEvaluationResult } from '../types/agent';
import { SafetyBase } from './safety-base';

/**
 * Validator for safety policies.
 * Extracted from SafetyEngine to reduce cognitive complexity and file size.
 */
export class PolicyValidator {
  constructor(private base: SafetyBase) {}

  /**
   * Check if a file path is allowed for the given policy.
   */
  async checkResourceAccess(
    policy: SafetyPolicy,
    resource: string,
    action: string,
    tier: SafetyTier,
    context?: { traceId?: string; userId?: string; toolName?: string; agentId?: string }
  ): Promise<SafetyEvaluationResult> {
    // Check blocked paths first
    if (policy.blockedFilePaths) {
      for (const pattern of policy.blockedFilePaths) {
        if (this.base.matchesGlob(resource, pattern)) {
          const violation = (this.base as any).createViolation(
            context?.agentId ?? 'unknown',
            tier,
            action,
            context?.toolName,
            resource,
            `Resource '${resource}' matches blocked pattern '${pattern}'`,
            'blocked',
            context?.traceId,
            context?.userId
          );
          await (this.base as any).logViolation(violation);

          return {
            allowed: false,
            requiresApproval: false,
            reason: `Access to '${resource}' is blocked`,
            appliedPolicy: 'blocked_resource',
            suggestion: 'Choose a different file path that is not protected',
          };
        }
      }
    }

    // Check allowed paths (if specified, resource must match at least one)
    if (policy.allowedFilePaths && policy.allowedFilePaths.length > 0) {
      const isAllowed = policy.allowedFilePaths.some((pattern) =>
        this.base.matchesGlob(resource, pattern)
      );

      if (!isAllowed) {
        const violation = (this.base as any).createViolation(
          context?.agentId ?? 'unknown',
          tier,
          action,
          context?.toolName,
          resource,
          `Resource '${resource}' not in allowed paths`,
          'blocked',
          context?.traceId,
          context?.userId
        );
        await (this.base as any).logViolation(violation);

        return {
          allowed: false,
          requiresApproval: false,
          reason: `Resource '${resource}' is not in the allowed list`,
          appliedPolicy: 'resource_not_allowed',
        };
      }
    }

    return { allowed: true, requiresApproval: false };
  }

  /**
   * Check time-based restrictions.
   */
  async checkTimeRestrictions(
    policy: SafetyPolicy,
    action: string,
    tier: SafetyTier,
    context?: { traceId?: string; userId?: string; toolName?: string; agentId?: string }
  ): Promise<SafetyEvaluationResult> {
    if (!policy.timeRestrictions || policy.timeRestrictions.length === 0) {
      return { allowed: true, requiresApproval: false };
    }

    const now = new Date();

    for (const restriction of policy.timeRestrictions) {
      if (!restriction.restrictedActions.includes(action)) {
        continue;
      }

      const isRestricted = this.isTimeInWindow(now, restriction);

      if (isRestricted) {
        if (restriction.restrictionType === 'block') {
          const violation = (this.base as any).createViolation(
            context?.agentId ?? 'unknown',
            tier,
            action,
            context?.toolName,
            undefined,
            `Action '${action}' blocked during restricted time window`,
            'blocked',
            context?.traceId,
            context?.userId
          );
          await (this.base as any).logViolation(violation);

          return {
            allowed: false,
            requiresApproval: false,
            reason: `Action '${action}' is not allowed during this time window`,
            appliedPolicy: 'time_restriction',
          };
        } else {
          const violation = (this.base as any).createViolation(
            context?.agentId ?? 'unknown',
            tier,
            action,
            context?.toolName,
            undefined,
            `Action '${action}' requires approval during restricted time window`,
            'approval_required',
            context?.traceId,
            context?.userId
          );
          await (this.base as any).logViolation(violation);

          return {
            allowed: true,
            requiresApproval: true,
            reason: `Action '${action}' requires approval during business hours`,
            appliedPolicy: 'time_restriction_approval',
          };
        }
      }
    }

    return { allowed: true, requiresApproval: false };
  }

  /**
   * Check approval requirements based on action type and policy.
   */
  async checkApprovalRequirements(
    policy: SafetyPolicy,
    action: string,
    tier: SafetyTier,
    context?: { traceId?: string; userId?: string; toolName?: string; agentId?: string }
  ): Promise<SafetyEvaluationResult> {
    let requiresApproval = false;
    let reason = '';

    switch (action) {
      case 'code_change':
        requiresApproval = !!policy.requireCodeApproval;
        reason = 'Code changes require approval in this safety tier';
        break;
      case 'deployment':
        requiresApproval = !!policy.requireDeployApproval;
        reason = 'Deployments require approval in this safety tier';
        break;
      case 'file_operation':
        requiresApproval = !!policy.requireFileApproval;
        reason = 'File operations require approval in this safety tier';
        break;
      case 'shell_command':
        requiresApproval = !!policy.requireShellApproval;
        reason = 'Shell commands require approval in this safety tier';
        break;
      case 'mcp_tool':
        requiresApproval = !!policy.requireMcpApproval;
        reason = 'MCP tool calls require approval in this safety tier';
        break;
      default:
        // By default, unknown actions in PROD require approval
        if (tier === SafetyTier.PROD) {
          requiresApproval = true;
          reason = `Unknown action '${action}' requires approval`;
        }
        break;
    }

    if (requiresApproval) {
      const violation = (this.base as any).createViolation(
        context?.agentId ?? 'unknown',
        tier,
        action,
        context?.toolName,
        undefined,
        reason,
        'approval_required',
        context?.traceId,
        context?.userId
      );
      await (this.base as any).logViolation(violation);

      return {
        allowed: true,
        requiresApproval: true,
        reason,
        appliedPolicy: `${tier}_${action}_approval`,
      };
    }

    return { allowed: true, requiresApproval: false };
  }

  /**
   * Check if current time falls within a time restriction window.
   */
  private isTimeInWindow(date: Date, restriction: TimeRestriction): boolean {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: restriction.timezone,
      hour: 'numeric',
      weekday: 'short',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = dayMap[weekdayStr] ?? 0;

    if (!restriction.daysOfWeek.includes(dayOfWeek)) {
      return false;
    }

    if (restriction.startHour <= restriction.endHour) {
      return hour >= restriction.startHour && hour < restriction.endHour;
    } else {
      return hour >= restriction.startHour || hour < restriction.endHour;
    }
  }
}
