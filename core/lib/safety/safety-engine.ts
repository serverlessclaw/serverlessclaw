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
  SafetyEvaluationResult,
  EvolutionMode,
} from '../types/agent';
import { logger } from '../logger';
import type { BaseMemoryProvider } from '../memory/base';
import { SafetyRateLimiter, ToolSafetyOverride } from './safety-limiter';
import { SafetyConfigManager } from './safety-config-manager';
import { EvolutionScheduler } from './evolution-scheduler';
import { CONFIG_DEFAULTS } from '../config/config-defaults';
import { SafetyBase } from './safety-base';
import { PolicyValidator } from './policy-validator';
import { TRUST } from '../constants';

/**
 * Safety Engine for evaluating actions against granular policies.
 * Refactored to comply with AIReady file length standards.
 */
export class SafetyEngine extends SafetyBase {
  private policies: Map<SafetyTier, Partial<SafetyPolicy>>;
  private toolOverrides: Map<string, ToolSafetyOverride>;
  private limiter: SafetyRateLimiter;
  private validator: PolicyValidator;
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
    this.validator = new PolicyValidator(this);
    this.evolutionScheduler = new EvolutionScheduler(base ?? undefined);

    if (customPolicies) {
      for (const [tier, overrides] of Object.entries(customPolicies)) {
        if (overrides) {
          this.policies.set(tier as SafetyTier, overrides);
        }
      }
    }

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
   * Heuristic scan of arguments for hidden file paths.
   */
  public scanArgumentsForPaths(args: Record<string, unknown>, pathKeys: string[] = []): string[] {
    const foundPaths = new Set<string>();
    const defaultPathKeys = ['path', 'filePath', 'source', 'destination', 'dir', 'file'];
    const allKeys = [...new Set([...defaultPathKeys, ...pathKeys])];

    for (const key of allKeys) {
      const val = args[key];
      if (
        typeof val === 'string' &&
        (val.includes('/') || val.includes('\\') || val.includes('.'))
      ) {
        foundPaths.add(val);
      }
    }

    const scanRecursive = (obj: unknown) => {
      if (!obj || typeof obj !== 'object' || obj === null) return;

      const record = obj as Record<string, unknown>;
      for (const value of Object.values(record)) {
        if (typeof value === 'string') {
          const isPathLike = value.includes('/') || value.includes('\\') || value.includes('.');
          if (isPathLike) {
            foundPaths.add(value);
          }
        } else if (typeof value === 'object' && value !== null) {
          scanRecursive(value);
        }
      }
    };
    scanRecursive(args);

    return Array.from(foundPaths);
  }

  /**
   * Discovers all resources involved in an action.
   */
  private discoverResources(
    action: string,
    context?: { resource?: string; args?: Record<string, unknown>; pathKeys?: string[] }
  ): Set<string> {
    const resources = new Set<string>();
    if (context?.resource) resources.add(context.resource);
    if (context?.args) {
      const discovered = this.scanArgumentsForPaths(context.args, context.pathKeys);
      discovered.forEach((p) => resources.add(p));
    }
    return resources;
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
      args?: Record<string, unknown>;
      pathKeys?: string[];
    }
  ): Promise<SafetyEvaluationResult> {
    const tier = agentConfig?.safetyTier ?? SafetyTier.PROD;
    const agentId = agentConfig?.id ?? 'unknown';

    // 0. Class D Check (Permanently Blocked per Silo 3 mandate)
    if (this.isClassDAction(action)) {
      const violation = this.createViolation(
        agentId,
        tier,
        action,
        context?.toolName,
        context?.resource,
        `Class D action '${action}' is permanently blocked by policy.`,
        'blocked',
        context?.traceId,
        context?.userId
      );
      await this.logViolation(violation);
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Action '${action}' is a Class D (Policy Protected) operation and is permanently blocked.`,
        appliedPolicy: 'class_d_blocked',
      };
    }

    // 1. Discover all resources involved
    const resourcesToCheck = this.discoverResources(action, context);

    // 2. Load policy for this tier
    const policies = await SafetyConfigManager.getPolicies();
    const basePolicy = policies[tier];
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

    // 3. Tool-specific overrides and rate limits
    if (context?.toolName) {
      const toolOverride = this.toolOverrides.get(context.toolName);
      if (toolOverride?.requireApproval) {
        const violation = this.createViolation(
          agentId,
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
      const rateLimitResult = await this.limiter.checkToolRateLimit(toolOverride, context.toolName);
      if (!rateLimitResult.allowed) return rateLimitResult;
    }

    // 4. Resource-level access control
    for (const resource of resourcesToCheck) {
      const resourceResult = await this.validator.checkResourceAccess(
        policy,
        resource,
        action,
        tier,
        { ...context, agentId }
      );

      // System protection escalation
      if (
        resourceResult.allowed &&
        !agentConfig?.manuallyApproved &&
        this.isSystemProtected(resource)
      ) {
        const violation = this.createViolation(
          agentId,
          tier,
          action,
          context?.toolName,
          resource,
          `System-level protection violation: '${resource}'`,
          'blocked',
          context?.traceId,
          context?.userId
        );
        await this.logViolation(violation);
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Access to protected system resource '${resource}' is blocked. Direct manipulation requires manual approval via 'manuallyApproved: true'.`,
          appliedPolicy: 'system_protection',
        };
      }
      if (!resourceResult.allowed || resourceResult.requiresApproval) return resourceResult;
    }

    // 5. Time and general approval requirements
    const timeResult = await this.validator.checkTimeRestrictions(policy, action, tier, {
      ...context,
      agentId,
    });
    if (!timeResult.allowed || timeResult.requiresApproval) return timeResult;

    const approvalResult = await this.validator.checkApprovalRequirements(policy, action, tier, {
      ...context,
      agentId,
    });

    // 6. Blast Radius Enforcement (Class C)
    if (this.isClassCAction(action)) {
      const blastRadiusError = await this.enforceClassCBlastRadius(agentId, action);
      if (blastRadiusError) {
        const violation = this.createViolation(
          agentId,
          tier,
          action,
          context?.toolName,
          context?.resource,
          blastRadiusError,
          'blocked',
          context?.traceId,
          context?.userId
        );
        await this.logViolation(violation);
        return {
          allowed: false,
          requiresApproval: false,
          reason: blastRadiusError,
          appliedPolicy: 'blast_radius_limit',
        };
      }

      await this.evolutionScheduler.scheduleAction({
        agentId,
        action,
        reason: approvalResult.reason ?? 'Class C action requiring approval',
        timeoutMs: CONFIG_DEFAULTS.EVOLUTIONARY_TIMEOUT_MS.code,
        resource: context?.resource,
        traceId: context?.traceId,
        userId: context?.userId,
      });
      await this.trackClassCBlastRadius(agentId, action, context?.resource);
    }

    // 7. Trust-Driven Autonomous Promotion (Principle 9)
    const trustScore = agentConfig?.trustScore ?? TRUST.DEFAULT_SCORE;
    const hasPromotionTrust = trustScore >= TRUST.AUTONOMY_THRESHOLD;
    const isAutoMode = agentConfig?.evolutionMode === EvolutionMode.AUTO;

    if (approvalResult.requiresApproval && hasPromotionTrust) {
      if (isAutoMode) {
        logger.info(
          `[SafetyEngine] Principle 9: Self-promoting action '${action}' (TrustScore: ${trustScore}, Mode: AUTO)`
        );
        const { emitEvent } = await import('../utils/bus');
        const { EventType } = await import('../types/agent');
        await emitEvent('safety.principle9', EventType.SYSTEM_AUDIT_TRIGGER, {
          agentId,
          action,
          trustScore,
          reason: `Trust-based autonomous promotion: trustScore >= 95`,
          timestamp: Date.now(),
        });
        return {
          allowed: true,
          requiresApproval: false,
          reason: `${approvalResult.reason} [AUTONOMOUS PROMOTION: TrustScore >= 95 & AUTO mode]`,
          appliedPolicy: 'principle_9_promotion',
        };
      } else {
        approvalResult.reason = `${approvalResult.reason} [ADVISORY: Candidate for trust-based autonomy promotion (TrustScore >= 95). Shift to AUTO mode to enable.]`;
      }
    }

    if (!approvalResult.allowed || approvalResult.requiresApproval) return approvalResult;

    // 8. General rate limits
    const rateLimitResult = await this.limiter.checkRateLimits(policy, action);
    if (!rateLimitResult.allowed) return rateLimitResult;

    return { allowed: true, requiresApproval: false, appliedPolicy: `${tier}_default` };
  }

  getStats() {
    const stats = {
      totalViolations: this.violations.length,
      blockedActions: 0,
      approvalRequired: 0,
      byTier: { [SafetyTier.LOCAL]: 0, [SafetyTier.PROD]: 0 },
      byAction: {} as Record<string, number>,
    };

    for (const violation of this.violations) {
      if (violation.outcome === 'blocked') stats.blockedActions++;
      else if (violation.outcome === 'approval_required') stats.approvalRequired++;
      stats.byTier[violation.safetyTier]++;
      stats.byAction[violation.action] = (stats.byAction[violation.action] || 0) + 1;
    }
    return stats;
  }

  updatePolicy(tier: SafetyTier, updates: Partial<SafetyPolicy>): void {
    const existing = this.policies.get(tier) || {};
    this.policies.set(tier, { ...existing, ...updates });
    logger.info('Safety policy updated', { tier, updates });
  }

  setToolOverride(override: ToolSafetyOverride): void {
    this.toolOverrides.set(override.toolName, override);
    logger.info('Tool safety override set', { toolName: override.toolName });
  }

  removeToolOverride(toolName: string): void {
    this.toolOverrides.delete(toolName);
    logger.info('Tool safety override removed', { toolName });
  }
}
