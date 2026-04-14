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

    const scanRecursive = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const [_key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          const isPathLike = value.includes('/') || value.includes('\\') || value.includes('.');
          if (isPathLike && this.isSystemProtected(value)) {
            foundPaths.add(value);
          }
        } else if (typeof value === 'object') {
          scanRecursive(value);
        }
      }
    };
    scanRecursive(args);

    return Array.from(foundPaths);
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

    const resourcesToCheck = new Set<string>();
    if (context?.resource) resourcesToCheck.add(context.resource);
    if (context?.args) {
      const discovered = this.scanArgumentsForPaths(context.args, context.pathKeys);
      discovered.forEach((p) => resourcesToCheck.add(p));
    }

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
      const rateLimitResult = await this.limiter.checkToolRateLimit(toolOverride, context.toolName);
      if (!rateLimitResult.allowed) return rateLimitResult;
    }

    for (const resource of resourcesToCheck) {
      const resourceResult = await this.validator.checkResourceAccess(
        policy,
        resource,
        action,
        tier,
        { ...context, agentId: agentConfig?.id }
      );
      if (
        resourceResult.allowed &&
        !agentConfig?.manuallyApproved &&
        this.isSystemProtected(resource)
      ) {
        const violation = this.createViolation(
          agentConfig?.id ?? 'unknown',
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

    const timeResult = await this.validator.checkTimeRestrictions(policy, action, tier, {
      ...context,
      agentId: agentConfig?.id,
    });
    if (!timeResult.allowed || timeResult.requiresApproval) return timeResult;

    const approvalResult = await this.validator.checkApprovalRequirements(policy, action, tier, {
      ...context,
      agentId: agentConfig?.id,
    });

    if (this.isClassCAction(action)) {
      const blastRadiusError = await this.enforceClassCBlastRadius(
        agentConfig?.id ?? 'unknown',
        action
      );
      if (blastRadiusError) {
        const violation = this.createViolation(
          agentConfig?.id ?? 'unknown',
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
        agentId: agentConfig?.id ?? 'unknown',
        action,
        reason: approvalResult.reason ?? 'Class C action requiring approval',
        timeoutMs: CONFIG_DEFAULTS.EVOLUTIONARY_TIMEOUT_MS.code,
        resource: context?.resource,
        traceId: context?.traceId,
        userId: context?.userId,
      });
      await this.trackClassCBlastRadius(agentConfig?.id ?? 'unknown', action, context?.resource);
    }

    const hasPromotionTrust =
      (agentConfig?.trustScore ?? TRUST.DEFAULT_SCORE) >= TRUST.AUTONOMY_THRESHOLD;
    const isAutoMode = agentConfig?.evolutionMode === EvolutionMode.AUTO;

    if (approvalResult.requiresApproval && hasPromotionTrust) {
      if (isAutoMode) {
        logger.info(
          `[SafetyEngine] Principle 9: Self-promoting action '${action}' (TrustScore: ${agentConfig?.trustScore}, Mode: AUTO)`
        );
        const { emitEvent } = await import('../utils/bus');
        const { EventType } = await import('../types/agent');
        await emitEvent('safety.principle9', EventType.SYSTEM_AUDIT_TRIGGER, {
          agentId: agentConfig?.id,
          action,
          trustScore: agentConfig?.trustScore,
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
