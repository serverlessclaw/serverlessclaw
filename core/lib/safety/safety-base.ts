/**
 * @module SafetyBase
 * @description Base class for SafetyEngine providing trust recording, violation tracking, and common utilities.
 */

import { TrustManager } from './trust-manager';
import { SafetyTier, SafetyViolation } from '../types/agent';
import { logger } from '../logger';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getMemoryTableName } from '../utils/ddb-client';
import { getBlastRadiusStore, BlastRadiusStore } from './blast-radius-store';
import { isProtectedPath, matchesGlob } from '../utils/fs-security';
import { CLASS_C_ACTIONS, CLASS_D_ACTIONS } from '../constants/safety';
import { MEMORY_KEYS, RETENTION, TIME } from '../constants';

export class SafetyBase {
  protected blastRadiusStore: BlastRadiusStore;

  constructor() {
    this.blastRadiusStore = getBlastRadiusStore();
  }

  /**
   * Records a failure for an agent and penalizes its trust score.
   */
  async recordFailure(
    agentId: string,
    reason: string,
    severity?: number,
    qualityScore?: number,
    context?: import('./trust-manager').TrustContext
  ): Promise<number> {
    return TrustManager.recordFailure(agentId, reason, severity, qualityScore, context);
  }

  /**
   * Records a success for an agent and increments its trust score.
   */
  async recordSuccess(
    agentId: string,
    qualityScore?: number,
    context?: import('./trust-manager').TrustContext
  ): Promise<number> {
    return TrustManager.recordSuccess(agentId, qualityScore, context);
  }

  /**
   * Checks if a resource path matches any system-level protection rules.
   */
  public isSystemProtected(resource: string): boolean {
    return isProtectedPath(resource);
  }

  /**
   * Determine if an action is Class C (sensitive change requiring approval).
   */
  public isClassCAction(action: string): boolean {
    return (CLASS_C_ACTIONS as readonly string[]).includes(action.toLowerCase());
  }

  /**
   * Determine if an action is Class D (permanently blocked).
   */
  public isClassDAction(action: string): boolean {
    return (CLASS_D_ACTIONS as readonly string[]).includes(action.toLowerCase());
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
    userId?: string,
    workspaceId?: string,
    teamId?: string,
    staffId?: string
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
      workspaceId,
      teamId,
      staffId,
    };
  }

  /**
   * Log a safety violation.
   */
  public async logViolation(violation: SafetyViolation): Promise<void> {
    // Persist ONLY the new violation to DynamoDB immediately for audit trail
    // This adheres to Silo 1 (Stateless Core) while being O(1) instead of O(N^2)
    await this.persistViolation(violation);

    logger.warn('Safety violation detected', {
      violationId: violation.id,
      agentId: violation.agentId,
      action: violation.action,
      reason: violation.reason,
      outcome: violation.outcome,
    });
  }

  /**
   * Persist a single violation to DynamoDB for audit trail.
   * Migrated to MemoryTable with TTL for efficient data aging (Principle 13).
   */
  async persistViolation(violation: SafetyViolation): Promise<boolean> {
    const tableName = getMemoryTableName();
    const docClient = getDocClient();

    const maxRetries = 2;
    const now = Date.now();
    // Unique key per violation using MemoryTable schema (userId=PK, timestamp=SK)
    // Sh2: Ensure multi-tenant isolation of audit trails
    const basePk = `${MEMORY_KEYS.SAFETY_VIOLATION_PREFIX}${violation.agentId}`;
    const pk = violation.workspaceId ? `WS#${violation.workspaceId}#${basePk}` : basePk;
    const sk = now;

    // Retention follows Traces (30 days by default)
    const expiresAt = Math.floor(now / TIME.MS_PER_SECOND) + RETENTION.TRACES_DAYS * 24 * 3600;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await docClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              userId: pk,
              timestamp: sk,
              type: 'SAFETY_VIOLATION',
              value: violation,
              expiresAt,
            },
          })
        );
        return true;
      } catch (e) {
        if (attempt === maxRetries) {
          logger.error(`[SafetyBase] Failed to persist violation ${pk} after retries: ${e}`);
        }
      }
    }
    return false;
  }

  /**
   * Track blast radius for Class C actions.
   */
  protected async trackClassCBlastRadius(
    agentId: string,
    action: string,
    resource?: string
  ): Promise<void> {
    const entry = await this.blastRadiusStore.incrementBlastRadius(agentId, action, resource);
    logger.info('[SafetyBase] Class C action tracked', { agentId, action, count: entry.count });
  }

  /**
   * Enforces blast radius limits for Class C actions per agent.
   */
  protected async enforceClassCBlastRadius(
    agentId: string,
    action: string
  ): Promise<string | null> {
    const result = await this.blastRadiusStore.canExecute(agentId, action);
    return result.allowed ? null : (result.error ?? 'BLAST_RADIUS_EXCEEDED');
  }

  public matchesGlob(path: string, pattern: string): boolean {
    return matchesGlob(path, pattern);
  }

  /**
   * Get Class C blast radius stats for all tracked actions.
   */
  public getClassCBlastRadius(): Record<
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
}
