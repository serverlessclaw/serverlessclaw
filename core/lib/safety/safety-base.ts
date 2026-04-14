/**
 * @module SafetyBase
 * @description Base class for SafetyEngine providing trust recording, violation tracking, and common utilities.
 */

import { TrustManager } from './trust-manager';
import { SafetyTier, SafetyViolation } from '../types/agent';
import { logger } from '../logger';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { defaultDocClient } from '../registry/config';
import { Resource } from 'sst';
import { getBlastRadiusStore, BlastRadiusStore } from './blast-radius-store';

export class SafetyBase {
  protected violations: SafetyViolation[] = [];
  protected blastRadiusStore: BlastRadiusStore;

  constructor() {
    this.blastRadiusStore = getBlastRadiusStore();
  }

  /**
   * Records a failure for an agent and penalizes its trust score.
   * Optionally takes a quality score (0-10) to weight the trust adjustment.
   */
  async recordFailure(
    agentId: string,
    reason: string,
    severity?: number,
    qualityScore?: number
  ): Promise<number> {
    return TrustManager.recordFailure(agentId, reason, severity, qualityScore);
  }

  /**
   * Records a success for an agent and increments its trust score.
   */
  async recordSuccess(agentId: string, qualityScore?: number): Promise<number> {
    return TrustManager.recordSuccess(agentId, qualityScore);
  }

  /**
   * System-level protected paths that are always blocked unless manually approved.
   */
  public static getSystemProtectedPaths(): string[] {
    return [
      'core/**',
      'infra/**',
      'docs/governance/**',
      '.github/**',
      '.antigravity/**',
      'sst.config.ts',
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      '.env',
    ];
  }

  /**
   * Checks if a resource path matches any system-level protection rules.
   */
  public isSystemProtected(resource: string): boolean {
    const protectedPaths = SafetyBase.getSystemProtectedPaths();
    return protectedPaths.some((pattern) => this.matchesGlob(resource, pattern));
  }

  /**
   * Class C actions that require blast radius tracking and elevated approval.
   * Aligned with PRINCIPLES.md Risk Classification Matrix:
   * - Class C: iam_change, infra_topology, security_guardrail, deployment, memory_retention, tool_permission
   * - Class D: trust_manipulation, blast_radius_limit (permanently blocked)
   */
  private static readonly CLASS_C_ACTIONS = [
    'iam_change',
    'infra_topology',
    'memory_retention',
    'tool_permission',
    'deployment',
    'security_guardrail',
    'code_change',
    'audit_override',
  ] as const;

  private static readonly CLASS_D_ACTIONS = [
    'trust_manipulation',
    'mode_shift',
    'policy_core_override',
  ] as const;

  /**
   * Determine if an action is Class C (sensitive change requiring approval).
   */
  public isClassCAction(action: string): boolean {
    return (SafetyBase.CLASS_C_ACTIONS as readonly string[]).includes(action.toLowerCase());
  }

  /**
   * Determine if an action is Class D (permanently blocked).
   */
  public isClassDAction(action: string): boolean {
    return (SafetyBase.CLASS_D_ACTIONS as readonly string[]).includes(action.toLowerCase());
  }

  /**
   * Get all registered Class C actions (for debugging/display).
   */
  public static getClassCActions(): readonly string[] {
    return [...SafetyBase.CLASS_C_ACTIONS];
  }

  /**
   * Get all registered Class D actions (for debugging/display).
   */
  public static getClassDActions(): readonly string[] {
    return [...SafetyBase.CLASS_D_ACTIONS];
  }

  /**
   * Create a safety violation record.
   */
  public createViolation(
    agentId: string,
    safetyTier: SafetyTier,
    action: string,
    toolName: string | undefined,
    resource: string | undefined,
    reason: string,
    outcome: 'blocked' | 'approval_required' | 'allowed',
    traceId?: string,
    userId?: string
  ): SafetyViolation {
    return {
      id: `violation_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      agentId,
      safetyTier,
      action,
      toolName,
      resource,
      reason,
      outcome,
      traceId,
      userId,
    };
  }

  /**
   * Log a safety violation.
   */
  public async logViolation(violation: SafetyViolation): Promise<void> {
    this.violations.push(violation);

    // Keep only last 1000 violations in memory
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-1000);
    }

    // Persist to DynamoDB for audit trail
    await this.persistViolations();

    logger.warn('Safety violation detected', {
      violationId: violation.id,
      agentId: violation.agentId,
      action: violation.action,
      toolName: violation.toolName,
      resource: violation.resource,
      reason: violation.reason,
      outcome: violation.outcome,
      traceId: violation.traceId,
    });
  }

  /**
   * Persist violations to DynamoDB for audit trail.
   * Implements retry logic with exponential backoff to prevent telemetry blindness.
   */
  async persistViolations(): Promise<void> {
    if (this.violations.length === 0) {
      return;
    }

    const resource = Resource as { ConfigTable?: { name: string } };
    if (!('ConfigTable' in resource)) {
      logger.error(
        '[CRITICAL] SafetyEngine telemetry blindness: ConfigTable not linked. Violations will NOT be persisted.'
      );
      this.queueFailedViolationsForRetry([...this.violations]);
      return;
    }

    const violationsToPersist = [...this.violations];
    const batchSize = 25;
    const now = Date.now();

    for (let i = 0; i < violationsToPersist.length; i += batchSize) {
      const batch = violationsToPersist.slice(i, i + batchSize);
      const agentIds = [...new Set(batch.map((v) => v.agentId))];
      const agentId = agentIds.length === 1 ? agentIds[0] : 'batch';

      const persisted = await this.persistBatchWithRetry(
        batch,
        agentId,
        now,
        resource.ConfigTable?.name
      );
      if (!persisted) {
        this.queueFailedViolationsForRetry(batch);
      }
    }

    logger.debug(`[SafetyEngine] Persisted ${violationsToPersist.length} violations to DynamoDB`);
  }

  /**
   * Retry logic for batch persistence with exponential backoff.
   */
  private async persistBatchWithRetry(
    batch: SafetyViolation[],
    agentId: string,
    now: number,
    tableName: string | undefined
  ): Promise<boolean> {
    const maxRetries = 3;
    const baseDelayMs = 100;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await defaultDocClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              key: `safety:violations:${agentId}:${now}`,
              value: {
                violations: batch,
                count: batch.length,
                timestamp: now,
              },
            },
          })
        );
        return true;
      } catch (e) {
        if (attempt < maxRetries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          logger.warn(
            `[SafetyEngine] Retry persist batch ${attempt + 1}/${maxRetries} after ${delay}ms: ${e}`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          logger.error(
            `[SafetyEngine] Failed to persist safety violations batch after ${maxRetries} retries:`,
            e
          );
        }
      }
    }
    return false;
  }

  /**
   * Queue failed violations for later retry to prevent telemetry blindness.
   */
  private failedViolationsQueue: SafetyViolation[] = [];

  private queueFailedViolationsForRetry(violations: SafetyViolation[]): void {
    this.failedViolationsQueue.push(...violations);
    logger.warn(
      `[SafetyEngine] Queued ${violations.length} violations for retry. Queue size: ${this.failedViolationsQueue.length}`
    );
  }

  /**
   * Retry persisted queued violations. Should be called periodically or on recovery.
   */
  async retryFailedViolations(): Promise<number> {
    if (this.failedViolationsQueue.length === 0) {
      return 0;
    }

    const toRetry = [...this.failedViolationsQueue];
    this.failedViolationsQueue = [];

    const resource = Resource as { ConfigTable?: { name: string } };
    const tableName = resource.ConfigTable?.name;

    if (!tableName) {
      this.failedViolationsQueue.push(...toRetry);
      logger.error('[SafetyEngine] Cannot retry - ConfigTable not available');
      return 0;
    }

    let successCount = 0;
    const batchSize = 25;

    for (let i = 0; i < toRetry.length; i += batchSize) {
      const batch = toRetry.slice(i, i + batchSize);
      const agentIds = [...new Set(batch.map((v) => v.agentId))];
      const agentId = agentIds.length === 1 ? agentIds[0] : 'batch';
      const now = Date.now();

      if (await this.persistBatchWithRetry(batch, agentId, now, tableName)) {
        successCount += batch.length;
      } else {
        this.failedViolationsQueue.push(...batch);
      }
    }

    logger.info(
      `[SafetyEngine] Retry completed: ${successCount}/${toRetry.length} violations persisted`
    );
    return successCount;
  }

  /**
   * Track blast radius for Class C actions.
   * Per AUDIT.md requirement: tracked per-agent per-action.
   * Now uses DynamoDB-backed BlastRadiusStore for persistence across cold starts.
   */
  protected async trackClassCBlastRadius(
    agentId: string,
    action: string,
    resource?: string
  ): Promise<void> {
    const entry = await this.blastRadiusStore.incrementBlastRadius(agentId, action, resource);

    logger.info('[SafetyEngine] Class C action tracked for blast radius', {
      agentId,
      action,
      resource,
      totalCount: entry.count,
    });
  }

  /**
   * Enforces blast radius limits for Class C actions per agent.
   * Returns an error message if the limit is exceeded, otherwise null.
   * Now uses DynamoDB-backed BlastRadiusStore for persistence.
   */
  protected async enforceClassCBlastRadius(
    agentId: string,
    action: string
  ): Promise<string | null> {
    const result = await this.blastRadiusStore.canExecute(agentId, action);

    if (!result.allowed && result.error) {
      logger.error(`[SafetyEngine] ${result.error}`);
      return result.error;
    }

    return null;
  }

  /**
   * Get Class C blast radius stats.
   */
  getClassCBlastRadius(): Record<
    string,
    { count: number; affectedResources: number; lastAction: number }
  > {
    const stats = this.blastRadiusStore.getLocalStats();
    const result: Record<string, { count: number; affectedResources: number; lastAction: number }> =
      {};
    for (const [key, entry] of Object.entries(stats)) {
      result[key] = {
        count: entry.count,
        affectedResources: entry.resourceCount,
        lastAction: entry.lastAction,
      };
    }
    return result;
  }

  /**
   * Get recent safety violations.
   */
  getViolations(limit: number = 100): SafetyViolation[] {
    return this.violations.slice(-limit);
  }

  /**
   * Get violations for a specific agent.
   */
  getViolationsByAgent(agentId: string, limit: number = 100): SafetyViolation[] {
    return this.violations.filter((v) => v.agentId === agentId).slice(-limit);
  }

  /**
   * Get violations for a specific action type.
   */
  getViolationsByAction(action: string, limit: number = 100): SafetyViolation[] {
    return this.violations.filter((v) => v.action === action).slice(-limit);
  }

  /**
   * Clear all violations (useful for testing).
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Simple glob pattern matching.
   * Handles ** (match any path including /), * (match except /), and ? (single char).
   */
  public matchesGlob(path: string, pattern: string): boolean {
    const regexSource = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*\*\//g, '___DIR___')
      .replace(/\*\*/g, '___ANY___')
      .replace(/\*/g, '___NONSLASH___')
      .replace(/\?/g, '.')
      .replace(/___DIR___/g, '(?:.*/)?')
      .replace(/___ANY___/g, '.*')
      .replace(/___NONSLASH___/g, '[^/]*');

    const regex = new RegExp(`^${regexSource}$`);
    return regex.test(path);
  }
}
