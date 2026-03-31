import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../logger';
import { CONFIG_DEFAULTS } from '../config/config-defaults';
import { reportHealthIssue } from '../lifecycle/health';
import { addTraceStep } from '../utils/trace-helper';
import { TRACE_TYPES } from '../constants';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const STATE_KEY = 'circuit_breaker_state';

export type CircuitBreakerStates = 'closed' | 'open' | 'half_open';
export type FailureType = 'deploy' | 'health';

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
}

export interface CanProceedResult {
  allowed: boolean;
  reason?: string;
  state: CircuitBreakerStates;
  failureCount: number;
}

function getTableName(): string {
  const resource = Resource as { ConfigTable?: { name?: string } };
  return resource.ConfigTable?.name ?? 'ConfigTable';
}

function freshState(): CircuitBreakerStateData {
  return {
    state: 'closed',
    failures: [],
    halfOpenProbes: 0,
    lastStateChange: Date.now(),
    lastFailureTime: 0,
    version: 1,
  };
}

async function loadState(): Promise<CircuitBreakerStateData> {
  try {
    const { Item } = await db.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { key: STATE_KEY },
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
      };
    }
  } catch (e) {
    logger.warn('Failed to load circuit breaker state, starting fresh:', e);
  }
  return freshState();
}

async function saveState(state: CircuitBreakerStateData): Promise<void> {
  const oldVersion = state.version;
  state.version += 1;

  try {
    await db.send(
      new PutCommand({
        TableName: getTableName(),
        Item: { key: STATE_KEY, value: state },
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
    logger.error('Failed to save circuit breaker state:', e);
    if (e instanceof Error) throw e;
    throw new Error(String(e));
  }
}

function pruneOldFailures(failures: FailureEntry[] | undefined, windowMs: number): FailureEntry[] {
  if (!failures) return [];
  const cutoff = Date.now() - windowMs;
  return failures.filter((f) => f.timestamp > cutoff);
}

export class CircuitBreaker {
  /**
   * Generic retry wrapper for concurrent DynamoDB updates.
   * Retries up to MAX_RETRIES with randomized backoff on contention.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const MAX_RETRIES = 3;
    let lastError: unknown = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        return await fn();
      } catch (e: unknown) {
        lastError = e;
        if (e instanceof Error && e.message.includes('concurrently')) {
          const delay = Math.random() * 50 * (i + 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        if (e instanceof Error) throw e;
        throw new Error(String(e));
      }
    }
    throw new Error(String(lastError));
  }

  /**
   * Records a failure and returns the new state.
   */
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
    let state = await loadState();
    const now = Date.now();

    const threshold = await this.getThreshold();
    const prunedFailures = pruneOldFailures(state.failures, windowMs);

    let stateChanged = false;
    const previousState = state.state;

    if (state.state === 'half_open') {
      logger.warn(`Circuit Breaker: Probe failed in half-open state. Reopening.`);
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
          `Circuit Breaker: ${prunedFailures.length + 1} failures in sliding window (threshold: ${threshold}). Opening circuit.`
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

    await saveState(state);

    // Trace: Circuit breaker state change
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
        },
        metadata: { event: 'circuit_breaker_state_change', newState: state.state },
      });
    }

    if (state.state === 'open' && context?.userId) {
      await reportHealthIssue({
        component: 'CircuitBreaker',
        issue: `Circuit breaker opened after ${state.failures.length} failures (type: ${type})`,
        severity: 'high',
        userId: context.userId,
        traceId: context.traceId,
        context: { failureType: type, threshold, windowMs },
      });
    }

    return state;
  }

  /**
   * Records a success and returns the new state.
   */
  async recordSuccess(): Promise<CircuitBreakerStateData> {
    return this.withRetry(() => this._recordSuccessInternal());
  }

  private async _recordSuccessInternal(): Promise<CircuitBreakerStateData> {
    const state = await loadState();
    const now = Date.now();

    if (state.state === 'half_open') {
      logger.info('Circuit Breaker: Probe succeeded. Closing circuit.');
      const updated: CircuitBreakerStateData = {
        ...state,
        state: 'closed',
        lastStateChange: now,
        halfOpenProbes: 0,
        failures: [],
      };

      // Trace: Circuit breaker recovery
      await addTraceStep(undefined, 'root', {
        type: TRACE_TYPES.CIRCUIT_BREAKER,
        content: {
          previousState: 'half_open',
          newState: 'closed',
          reason: 'Probe succeeded, circuit closed.',
        },
        metadata: { event: 'circuit_breaker_recovered' },
      });

      await saveState(updated);
      return updated;
    } else if (state.state === 'closed') {
      const updated: CircuitBreakerStateData = {
        ...state,
        failures: pruneOldFailures(state.failures, await this.getWindowMs()),
      };
      await saveState(updated);
      return updated;
    }

    return state;
  }

  /**
   * Checks if a deployment can proceed based on circuit breaker state.
   */
  async canProceed(deployType: 'autonomous' | 'emergency'): Promise<CanProceedResult> {
    return this.withRetry(() => this._canProceedInternal(deployType));
  }

  private async _canProceedInternal(
    deployType: 'autonomous' | 'emergency'
  ): Promise<CanProceedResult> {
    const state = await loadState();

    if (deployType === 'emergency') {
      logger.warn('Circuit Breaker: Emergency deployment bypass approved (logged).');
      return {
        allowed: true,
        reason: 'EMERGENCY_BYPASS',
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
      state.halfOpenProbes += 1;
      await saveState(state);

      return {
        allowed: true,
        reason: 'HALF_OPEN_PROBE',
        state: state.state,
        failureCount: state.failures.length,
      };
    }

    if (state.state === 'half_open') {
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
    const state = await loadState();
    const windowMs = await this.getWindowMs();
    return {
      ...state,
      failures: pruneOldFailures(state.failures, windowMs),
    };
  }

  async reset(): Promise<void> {
    await saveState(freshState());
    logger.info('Circuit Breaker: Manual reset to closed state.');
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

let _instance: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!_instance) {
    _instance = new CircuitBreaker();
  }
  return _instance;
}

export function resetCircuitBreakerInstance(): void {
  _instance = null;
}
