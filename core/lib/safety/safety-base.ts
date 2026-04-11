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

export class SafetyBase {
  protected violations: SafetyViolation[] = [];
  // Sh2 Fix: Track blast radius for Class C actions
  protected classCBlastRadius: Map<
    string,
    { count: number; affectedResources: number; lastAction: number }
  > = new Map();

  /**
   * Records a failure for an agent and penalizes its trust score.
   */
  async recordFailure(agentId: string, reason: string, severity?: number): Promise<number> {
    return TrustManager.recordFailure(agentId, reason, severity);
  }

  /**
   * Records a success for an agent and increments its trust score.
   */
  async recordSuccess(agentId: string): Promise<number> {
    return TrustManager.recordSuccess(agentId);
  }

  /**
   * Create a safety violation record.
   */
  protected createViolation(
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
  protected async logViolation(violation: SafetyViolation): Promise<void> {
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
   */
  async persistViolations(): Promise<void> {
    if (this.violations.length === 0) {
      return;
    }

    const resource = Resource as { ConfigTable?: { name: string } };
    if (!('ConfigTable' in resource)) {
      logger.warn('ConfigTable not linked. Skipping violation persistence.');
      return;
    }

    const violationsToPersist = [...this.violations];
    const batchSize = 25;

    for (let i = 0; i < violationsToPersist.length; i += batchSize) {
      const batch = violationsToPersist.slice(i, i + batchSize);
      try {
        await defaultDocClient.send(
          new PutCommand({
            TableName: resource.ConfigTable?.name,
            Item: {
              key: `safety:violations:${Date.now()}`,
              value: {
                violations: batch,
                count: batch.length,
                timestamp: Date.now(),
              },
            },
          })
        );
      } catch (e) {
        logger.error(`Failed to persist safety violations batch ${i}:`, e);
      }
    }

    logger.info(`[SafetyEngine] Persisted ${violationsToPersist.length} violations to DynamoDB`);
  }

  /**
   * Track blast radius for Class C actions.
   */
  protected trackClassCBlastRadius(action: string, resource?: string): void {
    const key = action;
    const existing = this.classCBlastRadius.get(key) || {
      count: 0,
      affectedResources: 0,
      lastAction: 0,
    };

    this.classCBlastRadius.set(key, {
      count: existing.count + 1,
      affectedResources: existing.affectedResources + (resource ? 1 : 0),
      lastAction: Date.now(),
    });

    logger.info('[SafetyEngine] Class C action tracked for blast radius', {
      action,
      resource,
      totalCount: existing.count + 1,
    });
  }

  /**
   * Get Class C blast radius stats.
   */
  getClassCBlastRadius(): Record<
    string,
    { count: number; affectedResources: number; lastAction: number }
  > {
    return Object.fromEntries(this.classCBlastRadius);
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
  protected matchesGlob(path: string, pattern: string): boolean {
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
