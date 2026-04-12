/**
 * @module SafetyEngine
 * @description Granular safety tier enforcement engine for Serverless Claw.
 * Evaluates actions against fine-grained policies including per-tool overrides,
 * resource-level controls, time-based windows, and comprehensive violation logging.
 */

import {
  SafetyTier,
  IAgentConfig,
  SafetyPolicy,
  TimeRestriction,
  SafetyEvaluationResult,
} from '../types/agent';
import { logger } from '../logger';
import type { BaseMemoryProvider } from '../memory/base';
import { SafetyRateLimiter, ToolSafetyOverride } from './safety-limiter';
import { SafetyConfigManager } from './safety-config-manager';
import { EvolutionScheduler } from './evolution-scheduler';
import { CONFIG_DEFAULTS } from '../config/config-defaults';
import { SafetyBase } from './safety-base';

/**
 * Safety Engine for evaluating actions against granular policies.
 */
export class SafetyEngine extends SafetyBase {
  private policies: Map<SafetyTier, Partial<SafetyPolicy>>;
  private toolOverrides: Map<string, ToolSafetyOverride>;
  private limiter: SafetyRateLimiter;
  private evolutionScheduler: EvolutionScheduler;

  constructor(
    customPolicies?: Partial<Record<SafetyTier, Partial<SafetyPolicy>>>,
    toolOverrides?: ToolSafetyOverride[],
    base?: BaseMemoryProvider
  ) {
    super();
    this.policies = new Map();
    this.toolOverrides = new Map();
    this.limiter = new SafetyRateLimiter(base);
    this.evolutionScheduler = new EvolutionScheduler(base!);

    // Apply custom policy overrides if provided at construction
    if (customPolicies) {
      for (const [tier, overrides] of Object.entries(customPolicies)) {
        if (overrides) {
          this.policies.set(tier as SafetyTier, overrides);
        }
      }
    }

    // Initialize tool overrides
    if (toolOverrides) {
      for (const override of toolOverrides) {
        this.toolOverrides.set(override.toolName, override);
      }
    }

    logger.info('SafetyEngine initialized', {
      tiers: Array.from(this.policies.keys()),
      toolOverrides: this.toolOverrides.size,
    });
  }

  /**
   * Evaluate whether an action is allowed based on the agent's safety tier.
   */
  async evaluateAction(
    agentConfig: Partial<IAgentConfig> | undefined,
    action: string,
    context?: {
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
    }
  ): Promise<SafetyEvaluationResult> {
    const tier = agentConfig?.safetyTier ?? SafetyTier.PROD;

    // 1. Fetch current policies (DDB with fallback)
    const policies = await SafetyConfigManager.getPolicies();
    const basePolicy = policies[tier];

    // 2. Merge with local overrides if any
    const localPolicy = this.policies.get(tier);
    const policy = localPolicy ? { ...basePolicy, ...localPolicy } : basePolicy;

    if (!policy) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Unknown safety tier: ${tier}`,
        appliedPolicy: 'unknown_tier',
      };
    }

    // Check tool-specific overrides first
    if (context?.toolName) {
      const toolOverride = this.toolOverrides.get(context.toolName);
      if (toolOverride?.requireApproval) {
        const violation = this.createViolation(
          agentConfig?.id ?? 'unknown',
          tier,
          action,
          context.toolName,
          context.resource,
          'Tool requires approval',
          'approval_required',
          context.traceId,
          context.userId
        );
        await this.logViolation(violation);

        return {
          allowed: true,
          requiresApproval: true,
          reason: `Tool '${context.toolName}' requires manual approval`,
          appliedPolicy: 'tool_override',
        };
      }

      // Check tool rate limits
      const rateLimitResult = await this.limiter.checkToolRateLimit(toolOverride, context.toolName);
      if (!rateLimitResult.allowed) {
        return rateLimitResult;
      }
    }

    // Check resource-level controls
    if (context?.resource) {
      const resourceResult = await this.checkResourceAccess(
        policy,
        context.resource,
        action,
        tier,
        {
          ...context,
          agentId: agentConfig?.id,
        }
      );
      if (!resourceResult.allowed || resourceResult.requiresApproval) {
        return resourceResult;
      }
    }

    // Check time-based restrictions
    const timeResult = await this.checkTimeRestrictions(policy, action, tier, {
      ...context,
      agentId: agentConfig?.id,
    });
    if (!timeResult.allowed || timeResult.requiresApproval) {
      return timeResult;
    }

    // Check action-specific approval requirements
    const approvalResult = await this.checkApprovalRequirements(policy, action, tier, {
      ...context,
      agentId: agentConfig?.id,
    });

    // If action requires approval and is Class C, schedule for proactive evolution
    if (approvalResult.requiresApproval && this.isClassCAction(action)) {
      await this.evolutionScheduler.scheduleAction({
        agentId: agentConfig?.id ?? 'unknown',
        action,
        reason: approvalResult.reason ?? 'Class C action requiring approval',
        timeoutMs: CONFIG_DEFAULTS.EVOLUTIONARY_TIMEOUT_MS.code,
        resource: context?.resource,
        traceId: context?.traceId,
        userId: context?.userId,
      });
      // Sh2 Fix: Track blast radius for Class C actions
      this.trackClassCBlastRadius(action, context?.resource);
    }

    if (approvalResult.requiresApproval && (agentConfig?.trustScore ?? 0) >= 90) {
      approvalResult.reason = `${approvalResult.reason} [ADVISORY: Candidate for trust-based autonomy promotion (TrustScore >= 90)]`;
    }

    if (!approvalResult.allowed || approvalResult.requiresApproval) {
      return approvalResult;
    }

    // Check rate limits
    const rateLimitResult = await this.limiter.checkRateLimits(policy, action);
    if (!rateLimitResult.allowed) {
      return rateLimitResult;
    }

    return {
      allowed: true,
      requiresApproval: false,
      appliedPolicy: `${tier}_default`,
    };
  }

  /**
   * Determine if an action is Class C (sensitive change).
   * Class C changes involve IAM, infra, retention, or security guardrails.
   */
  private isClassCAction(action: string): boolean {
    const classCActions = [
      'iam_change',
      'infra_topology',
      'memory_retention',
      'tool_permission',
      'deployment',
      'security_guardrail',
      'code_change', // Code changes that pass quality gates can be Class B or C; here we treat them as evolution candidates
    ];
    return classCActions.includes(action);
  }

  /**
   * Check if a file path is allowed for the given policy.
   */
  private async checkResourceAccess(
    policy: SafetyPolicy,
    resource: string,
    action: string,
    tier: SafetyTier,
    context?: { traceId?: string; userId?: string; toolName?: string; agentId?: string }
  ): Promise<SafetyEvaluationResult> {
    // Check blocked paths first
    if (policy.blockedFilePaths) {
      for (const pattern of policy.blockedFilePaths) {
        if (this.matchesGlob(resource, pattern)) {
          const violation = this.createViolation(
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
          await this.logViolation(violation);

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
        this.matchesGlob(resource, pattern)
      );

      if (!isAllowed) {
        const violation = this.createViolation(
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
        await this.logViolation(violation);

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
  private async checkTimeRestrictions(
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

      // Check if current time falls within restriction window
      const isRestricted = this.isTimeInWindow(now, restriction);

      if (isRestricted) {
        if (restriction.restrictionType === 'block') {
          const violation = this.createViolation(
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
          await this.logViolation(violation);

          return {
            allowed: false,
            requiresApproval: false,
            reason: `Action '${action}' is not allowed during this time window`,
            appliedPolicy: 'time_restriction',
          };
        } else {
          // require_approval
          const violation = this.createViolation(
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
          await this.logViolation(violation);

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
  private async checkApprovalRequirements(
    policy: SafetyPolicy,
    action: string,
    tier: SafetyTier,
    _context?: { traceId?: string; userId?: string; toolName?: string; agentId?: string }
  ): Promise<SafetyEvaluationResult> {
    switch (action) {
      case 'code_change':
        if (policy.requireCodeApproval) {
          const violation = this.createViolation(
            _context?.agentId ?? 'unknown',
            tier,
            action,
            _context?.toolName,
            undefined,
            'Code changes require approval in this safety tier',
            'approval_required',
            _context?.traceId,
            _context?.userId
          );
          await this.logViolation(violation);
          return {
            allowed: true,
            requiresApproval: true,
            reason: 'Code changes require approval in this safety tier',
            appliedPolicy: `${tier}_${action}_approval`,
          };
        }
        break;
      case 'deployment':
        if (policy.requireDeployApproval) {
          const violation = this.createViolation(
            _context?.agentId ?? 'unknown',
            tier,
            action,
            _context?.toolName,
            undefined,
            'Deployments require approval in this safety tier',
            'approval_required',
            _context?.traceId,
            _context?.userId
          );
          await this.logViolation(violation);
          return {
            allowed: true,
            requiresApproval: true,
            reason: 'Deployments require approval in this safety tier',
            appliedPolicy: `${tier}_${action}_approval`,
          };
        }
        break;
      case 'file_operation':
        if (policy.requireFileApproval) {
          const violation = this.createViolation(
            _context?.agentId ?? 'unknown',
            tier,
            action,
            _context?.toolName,
            undefined,
            'File operations require approval in this safety tier',
            'approval_required',
            _context?.traceId,
            _context?.userId
          );
          await this.logViolation(violation);
          return {
            allowed: true,
            requiresApproval: true,
            reason: 'File operations require approval in this safety tier',
            appliedPolicy: `${tier}_${action}_approval`,
          };
        }
        break;
      case 'shell_command':
        if (policy.requireShellApproval) {
          const violation = this.createViolation(
            _context?.agentId ?? 'unknown',
            tier,
            action,
            _context?.toolName,
            undefined,
            'Shell commands require approval in this safety tier',
            'approval_required',
            _context?.traceId,
            _context?.userId
          );
          await this.logViolation(violation);
          return {
            allowed: true,
            requiresApproval: true,
            reason: 'Shell commands require approval in this safety tier',
            appliedPolicy: `${tier}_${action}_approval`,
          };
        }
        break;
      case 'mcp_tool':
        if (policy.requireMcpApproval) {
          const violation = this.createViolation(
            _context?.agentId ?? 'unknown',
            tier,
            action,
            _context?.toolName,
            undefined,
            'MCP tool calls require approval in this safety tier',
            'approval_required',
            _context?.traceId,
            _context?.userId
          );
          await this.logViolation(violation);
          return {
            allowed: true,
            requiresApproval: true,
            reason: 'MCP tool calls require approval in this safety tier',
            appliedPolicy: `${tier}_${action}_approval`,
          };
        }
        break;
      default: {
        // Unknown actions require approval by default
        const violation = this.createViolation(
          _context?.agentId ?? 'unknown',
          tier,
          action,
          _context?.toolName,
          undefined,
          `Unknown action '${action}' requires approval`,
          'approval_required',
          _context?.traceId,
          _context?.userId
        );
        await this.logViolation(violation);
        return {
          allowed: true,
          requiresApproval: true,
          reason: `Unknown action '${action}' requires approval`,
          appliedPolicy: `${tier}_${action}_approval`,
        };
      }
    }

    return { allowed: true, requiresApproval: false };
  }

  /**
   * Check if current time falls within a time restriction window.
   */
  private isTimeInWindow(date: Date, restriction: TimeRestriction): boolean {
    // Get day/hour in the restriction's timezone using Intl.DateTimeFormat
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

    // Check if today is a restricted day
    if (!restriction.daysOfWeek.includes(dayOfWeek)) {
      return false;
    }

    // Check if current hour is within restriction window
    if (restriction.startHour <= restriction.endHour) {
      return hour >= restriction.startHour && hour < restriction.endHour;
    } else {
      return hour >= restriction.startHour || hour < restriction.endHour;
    }
  }

  /**
   * Get safety statistics.
   */
  getStats(): {
    totalViolations: number;
    blockedActions: number;
    approvalRequired: number;
    byTier: Record<SafetyTier, number>;
    byAction: Record<string, number>;
  } {
    const stats = {
      totalViolations: this.violations.length,
      blockedActions: 0,
      approvalRequired: 0,
      byTier: {
        [SafetyTier.LOCAL]: 0,
        [SafetyTier.PROD]: 0,
      },
      byAction: {} as Record<string, number>,
    };

    for (const violation of this.violations) {
      if (violation.outcome === 'blocked') {
        stats.blockedActions++;
      } else if (violation.outcome === 'approval_required') {
        stats.approvalRequired++;
      }

      stats.byTier[violation.safetyTier]++;
      stats.byAction[violation.action] = (stats.byAction[violation.action] || 0) + 1;
    }

    return stats;
  }

  /**
   * Update policy for a specific tier.
   */
  updatePolicy(tier: SafetyTier, updates: Partial<SafetyPolicy>): void {
    const existing = this.policies.get(tier) || {};
    this.policies.set(tier, { ...existing, ...updates });
    logger.info('Safety policy updated', { tier, updates });
  }

  /**
   * Add or update a tool override.
   */
  setToolOverride(override: ToolSafetyOverride): void {
    this.toolOverrides.set(override.toolName, override);
    logger.info('Tool safety override set', { toolName: override.toolName });
  }

  /**
   * Remove a tool override.
   */
  removeToolOverride(toolName: string): void {
    this.toolOverrides.delete(toolName);
    logger.info('Tool safety override removed', { toolName });
  }
}
