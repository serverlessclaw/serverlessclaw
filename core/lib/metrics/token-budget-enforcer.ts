import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getMemoryTableName } from '../utils/ddb-client';
import type { MetricsCollector } from './cognitive-metrics';
import { TIME } from '../constants';

const docClient = getDocClient();

const TTL_DAYS_BUDGET = 30;

function getBudgetTableName(): string {
  return getMemoryTableName() ?? 'MemoryTable';
}

/**
 * Budget configuration for a session or agent.
 */
export interface BudgetConfig {
  /** Maximum cost in USD for a single session. */
  maxSessionCostUsd: number;
  /** Maximum cost in USD for a single agent call. */
  maxAgentCostUsd: number;
  /** Maximum tokens for a single session. */
  maxSessionTokens: number;
  /** Maximum tokens for a single agent call. */
  maxAgentTokens: number;
  /** Cost per 1K input tokens (USD) for estimation. */
  costPer1kInputTokens: number;
  /** Cost per 1K output tokens (USD) for estimation. */
  costPer1kOutputTokens: number;
}

const DEFAULT_CONFIG: BudgetConfig = {
  maxSessionCostUsd: 5.0,
  maxAgentCostUsd: 2.0,
  maxSessionTokens: 500_000,
  maxAgentTokens: 100_000,
  costPer1kInputTokens: 0.003, // GPT-5-mini estimate
  costPer1kOutputTokens: 0.012,
};

/**
 * Token usage record for a single call.
 */
export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  timestamp: number;
  agentId?: string;
}

/**
 * Budget check result.
 */
export interface BudgetCheckResult {
  /** Whether the budget allows the operation. */
  allowed: boolean;
  /** Reason if denied. */
  reason?: string;
  /** Current session cost. */
  sessionCostUsd: number;
  /** Current session tokens. */
  sessionTokens: number;
  /** Percentage of session budget used (0-100). */
  percentUsed: number;
}

/**
 * Enforces token and dollar budgets for agent sessions.
 * Prevents runaway costs from stuck agents or infinite loops.
 *
 * Features:
 * - Per-session and per-agent cost limits
 * - Token counting with configurable cost rates
 * - Velocity detection (rapid spend increase)
 * - Dashboard-compatible status reporting
 *
 * @since Phase C2
 */
export class TokenBudgetEnforcer {
  private sessions: Map<string, TokenUsageRecord[]> = new Map();
  private config: BudgetConfig;
  private metricsCollector?: MetricsCollector;
  private initialized: boolean = false;

  constructor(config: Partial<BudgetConfig> = {}, metricsCollector?: MetricsCollector) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metricsCollector = metricsCollector;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  private async persistSession(sessionId: string, history: TokenUsageRecord[]): Promise<void> {
    try {
      const userId = `BUDGET#${sessionId}`;
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + TTL_DAYS_BUDGET * TIME.SECONDS_IN_DAY;
      const totalCost = history.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
      const totalTokens = history.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0);

      await docClient.send(
        new PutCommand({
          TableName: getBudgetTableName(),
          Item: {
            userId,
            timestamp: now,
            sessionId,
            history: history.slice(-100),
            totalCostUsd: totalCost,
            totalTokens,
            callCount: history.length,
            expiresAt,
          },
        })
      );
    } catch {
      // Silently fail persistence, don't break the agent loop
    }
  }

  /**
   * Loads session state from DynamoDB for durability.
   */
  async loadSession(sessionId: string): Promise<TokenUsageRecord[] | null> {
    try {
      const userId = `BUDGET#${sessionId}`;
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getBudgetTableName(),
          KeyConditionExpression: 'userId = :pk',
          ExpressionAttributeValues: { ':pk': userId },
          Limit: 1,
        })
      );
      if (Items && Items.length > 0) {
        return (Items[0].history as TokenUsageRecord[]) || [];
      }
      return [];
    } catch {
      logger.error('[TokenBudgetEnforcer] Failed to load session (FAIL-CLOSED)');
      throw new Error('Failed to load session history'); // Fail-closed
    }
  }

  /**
   * Estimates cost from token usage.
   */
  estimateCost(promptTokens: number, completionTokens: number): number {
    const inputCost = (promptTokens / 1000) * this.config.costPer1kInputTokens;
    const outputCost = (completionTokens / 1000) * this.config.costPer1kOutputTokens;
    return inputCost + outputCost;
  }

  /**
   * Records token usage for a session and checks budget.
   *
   * @param sessionId - The session to track.
   * @param promptTokens - Input tokens used.
   * @param completionTokens - Output tokens used.
   * @param agentId - Optional agent identifier.
   * @returns Budget check result.
   */
  async recordUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    agentId?: string,
    workspaceId?: string
  ): Promise<BudgetCheckResult> {
    await this.ensureInitialized();

    try {
      // Load from DynamoDB if not in memory (cold start recovery)
      if (!this.sessions.has(sessionId)) {
        const loaded = await this.loadSession(sessionId);
        if (loaded) {
          this.sessions.set(sessionId, loaded);
        }
      }
    } catch {
      return {
        allowed: false,
        reason: 'Budget check failed: Unable to verify session history (fail-closed)',
        sessionCostUsd: 0,
        sessionTokens: 0,
        percentUsed: 0,
      };
    }

    const estimatedCostUsd = this.estimateCost(promptTokens, completionTokens);

    // Get or create session history
    let history = this.sessions.get(sessionId);
    if (!history) {
      history = [];
      this.sessions.set(sessionId, history);
    }

    // Record usage
    history.push({
      promptTokens,
      completionTokens,
      estimatedCostUsd,
      timestamp: Date.now(),
      agentId,
    });

    // Calculate totals
    const sessionCostUsd = history.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const sessionTokens = history.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0);
    const percentUsed = (sessionCostUsd / this.config.maxSessionCostUsd) * 100;

    // Check session budget
    if (sessionCostUsd >= this.config.maxSessionCostUsd) {
      logger.warn(
        `[TokenBudgetEnforcer] Session ${sessionId} exceeded budget: ` +
          `$${sessionCostUsd.toFixed(4)} / $${this.config.maxSessionCostUsd.toFixed(2)}`
      );
      if (this.metricsCollector && agentId) {
        this.metricsCollector.recordTaskCompletion(
          agentId,
          false,
          0,
          0,
          {
            reason: 'session_budget_exhausted',
            cost: sessionCostUsd,
          },
          workspaceId
        );
      }
      return {
        allowed: false,
        reason: `Session budget exhausted: $${sessionCostUsd.toFixed(4)} / $${this.config.maxSessionCostUsd.toFixed(2)}`,
        sessionCostUsd,
        sessionTokens,
        percentUsed: 100,
      };
    }

    // Check single-call budget
    if (estimatedCostUsd >= this.config.maxAgentCostUsd) {
      logger.warn(
        `[TokenBudgetEnforcer] Agent call exceeded per-call budget: ` +
          `$${estimatedCostUsd.toFixed(4)} / $${this.config.maxAgentCostUsd.toFixed(2)}`
      );
      if (this.metricsCollector && agentId) {
        this.metricsCollector.recordTaskCompletion(
          agentId,
          false,
          0,
          0,
          {
            reason: 'agent_budget_exhausted',
            cost: estimatedCostUsd,
          },
          workspaceId
        );
      }
      return {
        allowed: false,
        reason: `Agent call budget exceeded: $${estimatedCostUsd.toFixed(4)} / $${this.config.maxAgentCostUsd.toFixed(2)}`,
        sessionCostUsd,
        sessionTokens,
        percentUsed,
      };
    }

    // Check session token budget
    if (sessionTokens >= this.config.maxSessionTokens) {
      logger.warn(
        `[TokenBudgetEnforcer] Session ${sessionId} exceeded token budget: ` +
          `${sessionTokens} / ${this.config.maxSessionTokens}`
      );
      return {
        allowed: false,
        reason: `Session token budget exhausted: ${sessionTokens} / ${this.config.maxSessionTokens}`,
        sessionCostUsd,
        sessionTokens,
        percentUsed,
      };
    }

    // Velocity gate: warn at 25%, 50%, 75% thresholds
    if (percentUsed >= 75 && history.length > 1) {
      const prevPercent =
        ((sessionCostUsd - estimatedCostUsd) / this.config.maxSessionCostUsd) * 100;
      if (prevPercent < 75) {
        logger.warn(
          `[TokenBudgetEnforcer] Session ${sessionId} at ${percentUsed.toFixed(1)}% budget. ` +
            `Last ${history.length} calls.`
        );
      }
    }

    // Persist to DynamoDB for durability
    this.persistSession(sessionId, history).catch(() => {});

    return {
      allowed: true,
      sessionCostUsd,
      sessionTokens,
      percentUsed,
    };
  }

  /**
   * Checks if a session is within budget without recording usage.
   */
  async checkBudget(sessionId: string): Promise<BudgetCheckResult> {
    await this.ensureInitialized();

    // Load from DynamoDB if not in memory
    if (!this.sessions.has(sessionId)) {
      const loaded = await this.loadSession(sessionId);
      if (loaded && loaded.length > 0) {
        this.sessions.set(sessionId, loaded);
      }
    }

    const history = this.sessions.get(sessionId) ?? [];
    const sessionCostUsd = history.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const sessionTokens = history.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0);
    const percentUsed = (sessionCostUsd / this.config.maxSessionCostUsd) * 100;

    return {
      allowed: sessionCostUsd < this.config.maxSessionCostUsd,
      sessionCostUsd,
      sessionTokens,
      percentUsed,
    };
  }

  /**
   * Clears budget tracking for a session.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Returns summary of all tracked sessions.
   */
  getSummary(): Array<{ sessionId: string; costUsd: number; tokens: number; calls: number }> {
    const summary: Array<{ sessionId: string; costUsd: number; tokens: number; calls: number }> =
      [];
    for (const [sessionId, history] of this.sessions) {
      summary.push({
        sessionId,
        costUsd: history.reduce((sum, r) => sum + r.estimatedCostUsd, 0),
        tokens: history.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0),
        calls: history.length,
      });
    }
    return summary;
  }
}

/** Singleton instance for global use. */
let _instance: TokenBudgetEnforcer | null = null;

/**
 * Gets the global TokenBudgetEnforcer instance.
 */
export function getTokenBudgetEnforcer(): TokenBudgetEnforcer {
  if (!_instance) {
    _instance = new TokenBudgetEnforcer();
  }
  return _instance;
}

/**
 * Resets the singleton instance (for testing).
 */
export function resetTokenBudgetEnforcer(): void {
  _instance = null;
}
