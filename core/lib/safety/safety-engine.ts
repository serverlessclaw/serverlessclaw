/**
 * @module SafetyEngine
 * @description Granular safety tier enforcement engine for Serverless Claw.
 */

import {
  SafetyTier,
  IAgentConfig,
  SafetyPolicy,
  SafetyEvaluationResult,
  EvolutionMode,
  EventType,
} from '../types/agent';
import { TRUST } from '../constants';
import { logger } from '../logger';
import { SafetyConfigManager } from './safety-config-manager';
import { SafetyRateLimiter, ToolSafetyOverride } from './safety-limiter';
import { PolicyValidator } from './policy-validator';
import { EvolutionScheduler } from './evolution-scheduler';
import { SafetyBase } from './safety-base';
import { scanForResources } from '../utils/fs-security';
import { BaseMemoryProvider } from '../memory/base';
import { emitEvent } from '../utils/bus';
import { AgentRegistry } from '../registry';
import { CONFIG_DEFAULTS } from '../config/config-defaults';

const CLASS_C_ACTIONS = ['deployment', 'shell_command', 'code_change', 'iam_change'];

let sharedEngine: SafetyEngine | null = null;

/**
 * Singleton access to the SafetyEngine.
 */
export function getSafetyEngine(
  customPolicies?: Partial<Record<SafetyTier, Partial<SafetyPolicy>>>,
  toolOverrides?: ToolSafetyOverride[],
  base?: BaseMemoryProvider
): SafetyEngine {
  if (!sharedEngine) {
    sharedEngine = new SafetyEngine(customPolicies, toolOverrides, base);
  }
  return sharedEngine;
}

export function resetSafetyEngine(
  customPolicies?: Partial<Record<SafetyTier, Partial<SafetyPolicy>>>,
  toolOverrides?: ToolSafetyOverride[],
  base?: BaseMemoryProvider
): SafetyEngine {
  sharedEngine = null;
  return getSafetyEngine(customPolicies, toolOverrides, base);
}

export function hasSafetyEngine(): boolean {
  return sharedEngine !== null;
}

function normalizeSafetyAction(action: string, toolName?: string): string {
  if (!toolName) return action;
  const lowerAction = action.toLowerCase();
  const lowerToolName = toolName.toLowerCase();
  if (CLASS_C_ACTIONS.map((a) => a.toLowerCase()).includes(lowerAction)) {
    return lowerAction;
  }
  if (lowerToolName.includes('deployment') || lowerToolName.includes('deploy')) {
    return 'deployment';
  }
  if (
    lowerToolName.includes('shell') ||
    lowerToolName.includes('command') ||
    lowerToolName.includes('exec')
  ) {
    return 'shell_command';
  }
  if (
    lowerToolName.includes('code_change') ||
    lowerToolName.includes('codechange') ||
    lowerToolName.includes('edit') ||
    lowerToolName.includes('write') ||
    lowerToolName.includes('create_file')
  ) {
    return 'code_change';
  }
  if (
    lowerToolName.includes('iam') ||
    lowerToolName.includes('permission') ||
    lowerToolName.includes('access')
  ) {
    return 'iam_change';
  }
  return action;
}

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
        if (overrides) this.policies.set(tier as SafetyTier, overrides);
      }
    }

    if (toolOverrides) {
      for (const override of toolOverrides) {
        this.toolOverrides.set(override.toolName, override);
      }
    }
  }

  /**
   * Evaluate whether an action is allowed based on the agent's safety tier.
   * Uses a declarative validation pipeline (Principle 10: Lean Evolution).
   */
  async evaluateAction(
    agentConfig: Partial<IAgentConfig> | undefined,
    action: string,
    context?: {
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
      args?: Record<string, unknown>;
      pathKeys?: string[];
    }
  ): Promise<SafetyEvaluationResult> {
    const tier = agentConfig?.safetyTier ?? SafetyTier.PROD;
    const agentId = agentConfig?.id ?? 'unknown';
    const workspaceId = context?.workspaceId;
    const teamId = context?.teamId;
    const staffId = context?.staffId;
    const ctx = { ...context, agentId, workspaceId, teamId, staffId };

    const normalizedAction = normalizeSafetyAction(action, context?.toolName);

    const policy = await this.getResolvedPolicy(tier);
    if (!policy) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Unknown safety tier: ${tier}`,
        appliedPolicy: 'unknown_tier',
      };
    }

    // Validation Pipeline
    const validators = [
      () => this.validateStaticPolicies(normalizedAction, ctx, tier),
      () => this.validateAccessControl(agentConfig, normalizedAction, ctx, tier, policy),
      () =>
        this.limiter.checkRateLimits(policy, normalizedAction, {
          workspaceId: ctx.workspaceId,
          teamId: ctx.teamId,
          staffId: ctx.staffId,
        }),
      () => this.validateDynamicRestrictions(agentConfig, normalizedAction, ctx, tier, policy),
    ];

    for (const validator of validators) {
      const result = await validator();
      if (
        !result.allowed ||
        result.requiresApproval ||
        result.appliedPolicy === 'principle_9_promotion'
      ) {
        if (result.violation) {
          await this.logViolation(result.violation);
        }
        return result;
      }
    }

    return { allowed: true, requiresApproval: false, appliedPolicy: `${tier}_default` };
  }

  private async validateStaticPolicies(
    action: string,
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
    },
    tier: SafetyTier
  ): Promise<SafetyEvaluationResult> {
    if (this.isClassDAction(action)) {
      return this.handleViolation(
        ctx,
        tier,
        action,
        'class_d_blocked',
        `Class D action '${action}' permanently blocked by policy.`
      );
    }
    return { allowed: true, requiresApproval: false };
  }

  private async validateAccessControl(
    agentConfig: Partial<IAgentConfig> | undefined,
    action: string,
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
      args?: Record<string, unknown>;
      pathKeys?: string[];
    },
    tier: SafetyTier,
    policy: SafetyPolicy
  ): Promise<SafetyEvaluationResult> {
    // Tool Overrides
    const toolResult = await this.checkToolSafety(ctx, tier, action);
    if (!toolResult.allowed || toolResult.requiresApproval) return toolResult;

    // Resource Discovery
    const discovered = scanForResources(ctx.args ?? {}, ctx.pathKeys);
    const resources = new Set(discovered.map((d) => d.path));
    if (ctx.resource) resources.add(ctx.resource);

    // Resource-Level Validation
    for (const res of resources) {
      const resResult = await this.validator.checkResourceAccess(policy, res, action, tier, ctx);
      // System Protection Escalation
      if (
        resResult.allowed &&
        agentConfig?.manuallyApproved !== true &&
        this.isSystemProtected(res)
      ) {
        return this.handleViolation(
          ctx,
          tier,
          action,
          'system_protection',
          `Access to protected system resource '${res}' is blocked. Direct manipulation requires manual approval via 'manuallyApproved: true'.`,
          'blocked',
          res
        );
      }
      if (!resResult.allowed || resResult.requiresApproval) return resResult;
    }

    return { allowed: true, requiresApproval: false };
  }

  private async validateDynamicRestrictions(
    agentConfig: Partial<IAgentConfig> | undefined,
    action: string,
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
      args?: Record<string, unknown>;
    },
    tier: SafetyTier,
    policy: SafetyPolicy
  ): Promise<SafetyEvaluationResult> {
    const timeResult = await this.validator.checkTimeRestrictions(policy, action, tier, ctx);
    if (!timeResult.allowed || timeResult.requiresApproval) return timeResult;

    const approvalResult = await this.validator.checkApprovalRequirements(
      policy,
      action,
      tier,
      ctx
    );

    // Trust-Driven Promotion (Principle 9)
    // Run this BEFORE scheduling Class C actions to prevent double execution
    const promotionResult = await this.checkAutonomousPromotion(
      agentConfig,
      action,
      approvalResult,
      ctx
    );

    const finalApprovalResult = promotionResult ?? approvalResult;

    // Blast Radius Enforcement (Class C)
    if (this.isClassCAction(action)) {
      const blastResult = await this.handleClassCAction(
        ctx.agentId,
        action,
        finalApprovalResult,
        ctx
      );
      if (blastResult) return blastResult;
    }

    return finalApprovalResult;
  }

  private async getResolvedPolicy(tier: SafetyTier): Promise<SafetyPolicy> {
    const globalPolicies = await SafetyConfigManager.getPolicies();
    const base = globalPolicies[tier];
    const custom = this.policies.get(tier);
    return custom ? { ...base, ...custom } : base;
  }

  private async handleViolation(
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
    },
    tier: SafetyTier,
    action: string,
    appliedPolicy: string,
    reason: string,
    outcome: 'blocked' | 'approval_required' = 'blocked',
    resource?: string
  ): Promise<SafetyEvaluationResult> {
    const violation = this.createViolation(
      ctx.agentId,
      tier,
      action,
      ctx.toolName,
      resource ?? ctx.resource,
      reason,
      outcome,
      ctx.traceId,
      ctx.userId,
      ctx.workspaceId,
      ctx.teamId,
      ctx.staffId
    );
    return {
      allowed: outcome === 'approval_required',
      requiresApproval: outcome === 'approval_required',
      reason,
      appliedPolicy,
      violation,
    };
  }

  private async checkToolSafety(
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
    },
    tier: SafetyTier,
    action: string
  ): Promise<SafetyEvaluationResult> {
    if (!ctx.toolName) return { allowed: true, requiresApproval: false };
    const override = this.toolOverrides.get(ctx.toolName);

    // Check rate limit first (blocks execution entirely) - more severe
    const rateLimitResult = await this.limiter.checkToolRateLimit(override, ctx.toolName, {
      workspaceId: ctx.workspaceId,
      teamId: ctx.teamId,
      staffId: ctx.staffId,
    });
    if (!rateLimitResult.allowed) {
      return rateLimitResult;
    }

    // Then check approval requirement
    if (override?.requireApproval) {
      return this.handleViolation(
        ctx,
        tier,
        action,
        'tool_override',
        `Tool '${ctx.toolName}' requires manual approval`,
        'approval_required'
      );
    }

    return { allowed: true, requiresApproval: false };
  }

  private async handleClassCAction(
    agentId: string,
    action: string,
    approvalResult: SafetyEvaluationResult,
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
      args?: Record<string, unknown>;
    }
  ): Promise<SafetyEvaluationResult | null> {
    const error = await this.enforceClassCBlastRadius(agentId, action);
    if (error) {
      const tier = (await AgentRegistry.getAgentConfig(agentId))?.safetyTier ?? SafetyTier.PROD;
      return this.handleViolation(ctx, tier, action, 'blast_radius_limit', error);
    }

    if (approvalResult.requiresApproval) {
      await this.evolutionScheduler.scheduleAction({
        agentId,
        action,
        reason: approvalResult.reason ?? 'Class C action requiring approval',
        timeoutMs: CONFIG_DEFAULTS.EVOLUTIONARY_TIMEOUT_MS.code,
        toolName: ctx.toolName,
        args: ctx.args,
        resource: ctx.resource,
        traceId: ctx.traceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        teamId: ctx.teamId,
        staffId: ctx.staffId,
      });
      return {
        allowed: false,
        requiresApproval: true,
        reason: approvalResult.reason ?? 'Class C action requires approval',
        appliedPolicy: 'class_c_approval_required',
      };
    }

    await this.trackClassCBlastRadius(agentId, action, ctx.resource);
    return null;
  }

  private async checkAutonomousPromotion(
    config: Partial<IAgentConfig> | undefined,
    action: string,
    approval: SafetyEvaluationResult,
    ctx: {
      agentId: string;
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
      args?: Record<string, unknown>;
    }
  ): Promise<SafetyEvaluationResult | null> {
    const trustScore = config?.trustScore ?? TRUST.DEFAULT_SCORE;
    const isAutoMode = config?.evolutionMode === EvolutionMode.AUTO;
    const hasTrust = trustScore >= TRUST.AUTONOMY_THRESHOLD;

    if (approval.requiresApproval && hasTrust) {
      if (isAutoMode) {
        logger.info(
          `[SafetyEngine] Principle 9: Self-promoting action '${action}' (Agent: ${ctx.agentId}, TrustScore: ${trustScore}, Mode: AUTO)`
        );
        await emitEvent('safety.principle9', EventType.SYSTEM_AUDIT_TRIGGER, {
          agentId: config?.id ?? 'unknown',
          workspaceId: ctx.workspaceId,
          teamId: ctx.teamId,
          staffId: ctx.staffId,
          action,
          trustScore,
          reason: `Trust-based autonomous promotion: trustScore >= 95`,
          timestamp: Date.now(),
        });
        return {
          allowed: true,
          requiresApproval: false,
          reason: `${approval.reason} [AUTONOMOUS PROMOTION: TrustScore >= 95 & AUTO mode]`,
          appliedPolicy: 'principle_9_promotion',
        };
      }
      approval.reason = `${approval.reason} [ADVISORY: Candidate for trust-based autonomy promotion (TrustScore >= 95). Shift to AUTO mode to enable.]`;
    }
    return null;
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
