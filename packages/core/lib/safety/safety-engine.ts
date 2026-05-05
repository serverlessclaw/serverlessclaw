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
} from '../types/agent';
import { TRUST } from '../constants';
import { CLASS_C_ACTIONS } from '../constants/safety';
import { SafetyConfigManager } from './safety-config-manager';
import { SafetyRateLimiter, ToolSafetyOverride } from './safety-limiter';
import { PolicyValidator } from './policy-validator';
import { EvolutionScheduler } from './evolution-scheduler';
import { SafetyBase } from './safety-base';
import { BaseMemoryProvider } from '../memory/base';
import { AgentRegistry } from '../registry';
import { CONFIG_DEFAULTS } from '../config/config-defaults';

// Specialized engine modules
import { validateStaticPolicies, validateRBAC } from './engine/rbac';
import { validateAccessControl } from './engine/access-control';
import { checkAutonomousPromotion } from './engine/autonomy';

let sharedEngine: SafetyEngine | null = null;

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
  if (lowerToolName.includes('deployment') || lowerToolName.includes('deploy')) return 'deployment';
  if (
    lowerToolName.includes('shell') ||
    lowerToolName.includes('command') ||
    lowerToolName.includes('exec')
  )
    return 'shell_command';
  if (
    lowerToolName.includes('code_change') ||
    lowerToolName.includes('edit') ||
    lowerToolName.includes('write')
  )
    return 'code_change';
  if (
    lowerToolName.includes('iam') ||
    lowerToolName.includes('permission') ||
    lowerToolName.includes('access')
  )
    return 'iam_change';
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

  async evaluateAction(
    agentConfig: Partial<IAgentConfig> | undefined,
    action: string,
    context?: any
  ): Promise<SafetyEvaluationResult> {
    const tier = agentConfig?.safetyTier ?? SafetyTier.PROD;
    const agentId = agentConfig?.id ?? 'unknown';
    const workspaceId = context?.workspaceId;
    const ctx = { ...context, agentId, workspaceId };

    const normalizedAction = normalizeSafetyAction(action, context?.toolName);
    const policy = await this.getResolvedPolicy(tier, workspaceId, context?.orgId);
    if (!policy) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Unknown safety tier: ${tier}`,
      };
    }

    // 1. Hard Security Blocks
    const staticResult = await validateStaticPolicies(
      normalizedAction,
      ctx,
      tier,
      this.handleViolation.bind(this)
    );
    if (!staticResult.allowed) return staticResult;

    const rbacResult = await validateRBAC(
      normalizedAction,
      ctx,
      tier,
      this.handleViolation.bind(this)
    );
    if (!rbacResult.allowed) return rbacResult;

    const accessResult = await validateAccessControl(
      agentConfig,
      normalizedAction,
      ctx,
      tier,
      policy,
      this,
      this.validator
    );
    if (!accessResult.allowed || accessResult.requiresApproval) return accessResult;

    const rateResult = await this.limiter.checkRateLimits(policy, normalizedAction, ctx);
    if (!rateResult.allowed) return rateResult;

    // 2. Trust-Driven Autonomy (Principle 9)
    if (
      context?.isProactive &&
      (agentConfig?.trustScore ?? 0) >= TRUST.AUTONOMY_THRESHOLD &&
      agentConfig?.evolutionMode === EvolutionMode.AUTO
    ) {
      return { allowed: true, requiresApproval: false, appliedPolicy: 'principle_9_proactive' };
    }

    // 3. Dynamic & Soft Restrictions
    const timeResult = await this.validator.checkTimeRestrictions(
      policy,
      normalizedAction,
      tier,
      ctx
    );
    if (!timeResult.allowed || timeResult.requiresApproval) return timeResult;

    const approvalResult = await this.validator.checkApprovalRequirements(
      policy,
      normalizedAction,
      tier,
      ctx
    );
    const promotionResult = await checkAutonomousPromotion(
      agentConfig,
      normalizedAction,
      approvalResult,
      ctx
    );
    const finalApprovalResult = promotionResult ?? approvalResult;

    // Blast Radius Enforcement
    if (this.isClassCAction(normalizedAction)) {
      const blastResult = await this.handleClassCAction(
        agentId,
        normalizedAction,
        finalApprovalResult,
        ctx
      );
      if (blastResult) return blastResult;
    }

    return finalApprovalResult;
  }

  private async getResolvedPolicy(
    tier: SafetyTier,
    workspaceId?: string,
    orgId?: string
  ): Promise<SafetyPolicy> {
    const globalPolicies = await SafetyConfigManager.getPolicies({ workspaceId, orgId });
    const base = globalPolicies[tier];
    const custom = this.policies.get(tier);
    return custom ? { ...base, ...custom } : base;
  }

  public async handleViolation(
    ctx: any,
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
      ctx.orgId,
      ctx.teamId,
      ctx.staffId
    );
    if (violation) await this.logViolation(violation);
    return {
      allowed: outcome === 'approval_required',
      requiresApproval: outcome === 'approval_required',
      reason,
      appliedPolicy,
      violation,
    };
  }

  public async checkToolSafety(
    ctx: any,
    tier: SafetyTier,
    action: string
  ): Promise<SafetyEvaluationResult> {
    if (!ctx.toolName) return { allowed: true, requiresApproval: false };
    const override = this.toolOverrides.get(ctx.toolName);
    const rateLimitResult = await this.limiter.checkToolRateLimit(override, ctx.toolName, ctx);
    if (!rateLimitResult.allowed) return rateLimitResult;
    if (override?.requireApproval)
      return this.handleViolation(
        ctx,
        tier,
        action,
        'tool_override',
        `Tool '${ctx.toolName}' requires manual approval`,
        'approval_required'
      );
    return { allowed: true, requiresApproval: false };
  }

  private async handleClassCAction(
    agentId: string,
    action: string,
    approvalResult: SafetyEvaluationResult,
    ctx: any
  ): Promise<SafetyEvaluationResult | null> {
    const error = await this.enforceClassCBlastRadius(agentId, action, ctx.workspaceId);
    if (error) {
      const tier =
        (await AgentRegistry.getAgentConfig(agentId, { workspaceId: ctx.workspaceId }))
          ?.safetyTier ?? SafetyTier.PROD;
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
        userId: ctx.userId || 'SYSTEM',
        workspaceId: ctx.workspaceId || 'GLOBAL',
        teamId: ctx.teamId,
        orgId: ctx.orgId,
        staffId: ctx.staffId,
      });
      return {
        allowed: false,
        requiresApproval: true,
        reason: approvalResult.reason ?? 'Class C action requires approval',
        appliedPolicy: 'class_c_approval_required',
      };
    }
    await this.trackClassCBlastRadius(agentId, action, ctx.workspaceId, ctx.resource);
    return null;
  }

  updatePolicy(tier: SafetyTier, updates: Partial<SafetyPolicy>): void {
    const existing = this.policies.get(tier) || {};
    this.policies.set(tier, { ...existing, ...updates });
  }

  setToolOverride(override: ToolSafetyOverride): void {
    this.toolOverrides.set(override.toolName, override);
  }

  removeToolOverride(toolName: string): void {
    this.toolOverrides.delete(toolName);
  }
}
