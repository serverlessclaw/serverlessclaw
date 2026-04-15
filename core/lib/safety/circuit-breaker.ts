import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getConfigTableName } from '../utils/ddb-client';
import { CONFIG_DEFAULTS } from '../config/config-defaults';
import { reportHealthIssue } from '../lifecycle/health';
import { addTraceStep } from '../utils/trace-helper';
import { TRACE_TYPES } from '../constants';

export type CircuitBreakerStates = 'closed' | 'open' | 'half_open';
export type FailureType = 'deploy' | 'health' | 'connection';

interface FailureEntry {
  timestamp: number;
  type: FailureType;
}

export interface CircuitBreakerStateData {
  state: CircuitBreakerStates;
  failures: FailureEntry[];
  halfOpenProbes: number;
  lastStateChange: number;
  lastFailureTime: number;
  version: number;
  emergencyDeployCount: number;
  emergencyDeployWindowStart: number;
}

export interface CanProceedResult {
  allowed: boolean;
  reason?: string;
  state: CircuitBreakerStates;
  failureCount: number;
}

function freshState(): CircuitBreakerStateData {
  return {
    state: 'closed',
    failures: [],
    halfOpenProbes: 0,
    lastStateChange: Date.now(),
    lastFailureTime: 0,
    version: 1,
    emergencyDeployCount: 0,
    emergencyDeployWindowStart: Date.now(),
  };
}

function pruneOldFailures(failures: FailureEntry[] | undefined, windowMs: number): FailureEntry[] {
  if (!failures) return [];
  const cutoff = Date.now() - windowMs;
  return failures.filter((f) => f.timestamp > cutoff);
}

export class CircuitBreaker {
  private readonly stateKey: string;

  constructor(key: string = 'circuit_breaker_state') {
    this.stateKey = key;
  }

  private async loadState(): Promise<CircuitBreakerStateData> {
    const db = getDocClient();
    try {
      const { Item } = await db.send(
        new GetCommand({
          TableName: getConfigTableName(),
          Key: { key: this.stateKey },
        })
      );
      if (Item?.value && typeof Item.value === 'object' && 'state' in Item.value) {
        const loaded = Item.value as Partial<CircuitBreakerStateData>;
        return {
          state: (loaded.state as CircuitBreakerStates) ?? 'closed',
          failures: Array.isArray(loaded.failures) ? loaded.failures : [],
          halfOpenProbes: loaded.halfOpenProbes ?? 0,
          lastStateChange: loaded.lastStateChange ?? Date.now(),
          lastFailureTime: loaded.lastFailureTime ?? 0,
          version: loaded.version ?? 1,
          emergencyDeployCount: loaded.emergencyDeployCount ?? 0,
          emergencyDeployWindowStart: loaded.emergencyDeployWindowStart ?? Date.now(),
        };
      }
    } catch (e) {
      logger.warn(`Failed to load circuit breaker state for ${this.stateKey}, starting fresh:`, e);
    }
    return freshState();
  }

  private async saveState(state: CircuitBreakerStateData): Promise<void> {
    const db = getDocClient();
    const oldVersion = state.version;
    state.version += 1;

    try {
      await db.send(
        new PutCommand({
          TableName: getConfigTableName(),
          Item: { key: this.stateKey, value: state },
          ConditionExpression: 'attribute_not_exists(#v) OR #v.version = :oldVersion',
          ExpressionAttributeNames: {
            '#v': 'value',
          },
          ExpressionAttributeValues: {
            ':oldVersion': oldVersion,
          },
        })
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        throw e;
      }
      logger.error(`Failed to save circuit breaker state for ${this.stateKey}:`, e);
      if (e instanceof Error) throw e;
      throw new Error(String(e));
    }
  }

  /**
   * Generic retry wrapper for concurrent DynamoDB updates.
   * Retries up to MAX_RETRIES with exponential backoff and jitter on contention.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 50;
    let lastError: unknown = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        return await fn();
      } catch (e: unknown) {
        lastError = e;
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
          const jitter = Math.random() * BASE_DELAY_MS * 2;
          const delay = BASE_DELAY_MS * Math.pow(2, i) + jitter;
          logger.warn(
            `Circuit breaker retry ${i + 1}/${MAX_RETRIES} after ${Math.round(delay)}ms due to concurrent modification`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        if (e instanceof Error) throw e;
        throw new Error(String(e));
      }
    }
    throw new Error(String(lastError));
  }

  async recordFailure(
    type: FailureType,
    context?: { userId?: string; traceId?: string }
  ): Promise<CircuitBreakerStateData> {
    return this.withRetry(() => this._recordFailureInternal(type, context));
  }

  private async _recordFailureInternal(
    type: FailureType,
    context?: { userId?: string; traceId?: string }
  ): Promise<CircuitBreakerStateData> {
    const windowMs = await this.getWindowMs();
    let state = await this.loadState();
    const now = Date.now();

    const threshold = await this.getThreshold();
    const prunedFailures = pruneOldFailures(state.failures, windowMs);

    let stateChanged = false;
    const previousState = state.state;

    if (state.state === 'half_open') {
      logger.warn(
        `Circuit Breaker (${this.stateKey}): Probe failed in half-open state. Reopening.`
      );
      state = {
        ...state,
        state: 'open',
        lastStateChange: now,
        halfOpenProbes: 0,
        lastFailureTime: now,
        failures: [...prunedFailures, { timestamp: now, type }],
      };
      stateChanged = true;
    } else if (state.state === 'closed') {
      if (prunedFailures.length + 1 >= threshold) {
        logger.warn(
          `Circuit Breaker (${this.stateKey}): ${prunedFailures.length + 1} failures in sliding window (threshold: ${threshold}). Opening circuit.`
        );
        state = {
          ...state,
          state: 'open',
          lastStateChange: now,
          lastFailureTime: now,
          failures: [...prunedFailures, { timestamp: now, type }],
        };
        stateChanged = true;
      } else {
        state = {
          ...state,
          lastFailureTime: now,
          failures: [...prunedFailures, { timestamp: now, type }],
        };
      }
    } else {
      state = {
        ...state,
        lastFailureTime: now,
        failures: [...prunedFailures, { timestamp: now, type }],
      };
    }

    await this.saveState(state);

    if (stateChanged && context?.traceId) {
      await addTraceStep(context.traceId, 'root', {
        type: TRACE_TYPES.CIRCUIT_BREAKER,
        content: {
          previousState,
          newState: state.state,
          failureType: type,
          failureCount: state.failures.length,
          threshold,
          windowMs,
          reason: `Circuit breaker transitioned from ${previousState} to ${state.state}`,
          key: this.stateKey,
        },
        metadata: { event: 'circuit_breaker_state_change', newState: state.state },
      });
    }

    if (state.state === 'open' && context?.userId) {
      await reportHealthIssue({
        component: 'CircuitBreaker',
        issue: `Circuit breaker ${this.stateKey} opened after ${state.failures.length} failures (type: ${type})`,
        severity: 'high',
        userId: context.userId,
        traceId: context.traceId,
        context: { failureType: type, threshold, windowMs, key: this.stateKey },
      });
    }

    return state;
  }

  async recordSuccess(): Promise<CircuitBreakerStateData> {
    return this.withRetry(() => this._recordSuccessInternal());
  }

  private async _recordSuccessInternal(): Promise<CircuitBreakerStateData> {
    const state = await this.loadState();
    const now = Date.now();

    if (state.state === 'half_open') {
      logger.info(`Circuit Breaker (${this.stateKey}): Probe succeeded. Closing circuit.`);
      const updated: CircuitBreakerStateData = {
        ...state,
        state: 'closed',
        lastStateChange: now,
        halfOpenProbes: 0,
        failures: [],
      };

      await addTraceStep('system', 'root', {
        type: TRACE_TYPES.CIRCUIT_BREAKER,
        content: {
          previousState: 'half_open',
          newState: 'closed',
          reason: 'Probe succeeded, circuit closed.',
          key: this.stateKey,
        },
        metadata: { event: 'circuit_breaker_recovered' },
      });

      await this.saveState(updated);
      return updated;
    } else if (state.state === 'closed') {
      const updated: CircuitBreakerStateData = {
        ...state,
        failures: pruneOldFailures(state.failures, await this.getWindowMs()),
      };
      await this.saveState(updated);
      return updated;
    }

    return state;
  }

  async canProceed(deployType: 'autonomous' | 'emergency'): Promise<CanProceedResult> {
    return this.withRetry(() => this._canProceedInternal(deployType));
  }

  private async _canProceedInternal(
    deployType: 'autonomous' | 'emergency'
  ): Promise<CanProceedResult> {
    const state = await this.loadState();

    if (deployType === 'emergency') {
      const now = Date.now();
      const emergencyWindowMs = 3600000;

      if (now - state.emergencyDeployWindowStart > emergencyWindowMs) {
        state.emergencyDeployCount = 0;
        state.emergencyDeployWindowStart = now;
      }

      const emergencyRateLimit = await (
        await import('../registry/config')
      ).ConfigManager.getTypedConfig(
        'circuit_breaker_emergency_rate_limit',
        CONFIG_DEFAULTS.CIRCUIT_BREAKER_EMERGENCY_RATE_LIMIT.code
      );

      if (state.emergencyDeployCount >= emergencyRateLimit) {
        logger.warn(
          `Circuit Breaker (${this.stateKey}): Emergency deployment rate limit exceeded (${state.emergencyDeployCount}/hr)`
        );
        return {
          allowed: false,
          reason: `EMERGENCY_RATE_LIMIT_EXCEEDED: ${state.emergencyDeployCount}/${emergencyRateLimit} in last hour`,
          state: state.state,
          failureCount: state.failures.length,
        };
      }

      state.emergencyDeployCount += 1;
      await this.saveState(state);

      logger.warn(
        `Circuit Breaker (${this.stateKey}): Emergency deployment approved with rate limiting.`
      );
      return {
        allowed: true,
        reason: 'EMERGENCY_BYPASS_WITH_RATE_LIMIT',
        state: state.state,
        failureCount: state.failures.length,
      };
    }

    if (state.state === 'open') {
      const cooldownMs = await (
        await import('../registry/config')
      ).ConfigManager.getTypedConfig(
        'circuit_breaker_cooldown_ms',
        CONFIG_DEFAULTS.CIRCUIT_BREAKER_COOLDOWN_MS.code
      );

      if (Date.now() - state.lastStateChange < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - state.lastStateChange)) / 60000);
        return {
          allowed: false,
          reason: `Circuit is open. Cooldown active. Try again in ~${remaining} minute(s).`,
          state: state.state,
          failureCount: state.failures.length,
        };
      }

      const halfOpenMax = await (
        await import('../registry/config')
      ).ConfigManager.getTypedConfig(
        'circuit_breaker_half_open_max',
        CONFIG_DEFAULTS.CIRCUIT_BREAKER_HALF_OPEN_MAX.code
      );

      if (state.halfOpenProbes >= halfOpenMax) {
        return {
          allowed: false,
          reason: `Circuit is in half-open state but max probes (${halfOpenMax}) exhausted. Waiting for successful probe.`,
          state: state.state,
          failureCount: state.failures.length,
        };
      }

      state.state = 'half_open';
      state.lastStateChange = Date.now();
      await this.saveState(state);

      return {
        allowed: true,
        reason: 'HALF_OPEN_PROBE',
        state: state.state,
        failureCount: state.failures.length,
      };
    }

    if (state.state === 'half_open') {
      const halfOpenMax = await (
        await import('../registry/config')
      ).ConfigManager.getTypedConfig(
        'circuit_breaker_half_open_max',
        CONFIG_DEFAULTS.CIRCUIT_BREAKER_HALF_OPEN_MAX.code
      );

      if (state.halfOpenProbes >= halfOpenMax) {
        return {
          allowed: false,
          reason: `HALF_OPEN_PROBES_EXHAUSTED: ${state.halfOpenProbes}/${halfOpenMax} probes used`,
          state: state.state,
          failureCount: state.failures.length,
        };
      }

      state.halfOpenProbes += 1;
      await this.saveState(state);

      return {
        allowed: true,
        reason: 'HALF_OPEN_PROBE',
        state: state.state,
        failureCount: state.failures.length,
      };
    }

    return {
      allowed: true,
      state: 'closed',
      failureCount: state.failures.length,
    };
  }

  async getState(): Promise<CircuitBreakerStateData> {
    const state = await this.loadState();
    const windowMs = await this.getWindowMs();
    return {
      ...state,
      failures: pruneOldFailures(state.failures, windowMs),
    };
  }

  async reset(): Promise<void> {
    await this.saveState(freshState());
    logger.info(`Circuit Breaker (${this.stateKey}): Manual reset to closed state.`);
  }

  private async getWindowMs(): Promise<number> {
    return await (
      await import('../registry/config')
    ).ConfigManager.getTypedConfig(
      'circuit_breaker_window_ms',
      CONFIG_DEFAULTS.CIRCUIT_BREAKER_WINDOW_MS.code
    );
  }

  private async getThreshold(): Promise<number> {
    return await (
      await import('../registry/config')
    ).ConfigManager.getTypedConfig(
      'circuit_breaker_threshold',
      CONFIG_DEFAULTS.CIRCUIT_BREAKER_THRESHOLD.code
    );
  }
}

const _instances: Map<string, CircuitBreaker> = new Map();

export function getCircuitBreaker(key: string = 'circuit_breaker_state'): CircuitBreaker {
  if (!_instances.has(key)) {
    _instances.set(key, new CircuitBreaker(key));
  }
  return _instances.get(key)!;
}

export function resetCircuitBreakerInstance(key?: string): void {
  if (key) {
    _instances.delete(key);
  } else {
    _instances.clear();
  }
}
