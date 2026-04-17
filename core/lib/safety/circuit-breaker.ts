import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getConfigTableName } from '../utils/ddb-client';
import { CONFIG_DEFAULTS } from '../config/config-defaults';
import { TRACE_TYPES } from '../constants/tracing';
import { addTraceStep } from '../utils/trace-helper';
import { reportHealthIssue } from '../lifecycle/health';

export type CircuitBreakerStates = 'closed' | 'open' | 'half_open';
export type FailureType = 'timeout' | 'error' | 'security' | 'validation' | 'recovery';

export interface CircuitBreakerStateData {
  state: CircuitBreakerStates;
  failures: { timestamp: number; type: string }[];
  lastFailureTime?: number;
  lastStateChange: number;
  halfOpenProbes: number;
  version: number;
  emergencyDeployCount: number;
  emergencyDeployWindowStart: number;
}

export interface CanProceedResult {
  allowed: boolean;
  state: CircuitBreakerStates;
  failureCount: number;
  reason?: string;
}

export class CircuitBreaker {
  private stateKey: string;

  constructor(key: string = 'circuit_breaker_state') {
    this.stateKey = key;
  }

  private freshState(): CircuitBreakerStateData {
    return {
      state: 'closed',
      failures: [],
      lastStateChange: Date.now(),
      halfOpenProbes: 0,
      version: 0,
      emergencyDeployCount: 0,
      emergencyDeployWindowStart: Date.now(),
    };
  }

  private async loadState(): Promise<CircuitBreakerStateData> {
    try {
      const { Item } = await getDocClient().send(
        new GetCommand({ TableName: getConfigTableName(), Key: { key: this.stateKey } })
      );
      if (Item?.value) return { ...this.freshState(), ...Item.value };
    } catch {
      logger.warn(`Failed to load circuit breaker state for ${this.stateKey}, using fresh state.`);
    }
    return this.freshState();
  }

  private async saveStateWithRetry(
    state: CircuitBreakerStateData,
    updateFn?: (s: CircuitBreakerStateData) => CircuitBreakerStateData
  ): Promise<CircuitBreakerStateData> {
    const db = getDocClient();
    const maxRetries = 3;
    let currentState = { ...state };

    for (let i = 0; i < maxRetries; i++) {
      const oldVersion = currentState.version;
      const nextState = { ...currentState, version: oldVersion + 1 };

      try {
        await db.send(
          new PutCommand({
            TableName: getConfigTableName(),
            Item: { key: this.stateKey, value: nextState },
            ConditionExpression: 'attribute_not_exists(#v) OR #v.version = :oldVersion',
            ExpressionAttributeNames: { '#v': 'value' },
            ExpressionAttributeValues: { ':oldVersion': oldVersion },
          })
        );
        return nextState;
      } catch (e: unknown) {
        if (
          e &&
          typeof e === 'object' &&
          'name' in e &&
          e.name === 'ConditionalCheckFailedException' &&
          i < maxRetries - 1
        ) {
          const fresh = await this.loadState();
          if (updateFn) {
            currentState = updateFn({ ...fresh });
          } else {
            currentState = { ...fresh };
          }
          continue;
        }
        throw e;
      }
    }
    return currentState;
  }

  async getState(): Promise<CircuitBreakerStateData> {
    return await this.loadState();
  }

  async recordFailure(
    type: string,
    ctx?: { userId?: string; traceId?: string }
  ): Promise<CircuitBreakerStateData> {
    const windowMs = await this.getConfig(
      'circuit_breaker_window_ms',
      CONFIG_DEFAULTS.CIRCUIT_BREAKER_WINDOW_MS.code
    );
    const threshold = await this.getConfig(
      'circuit_breaker_threshold',
      CONFIG_DEFAULTS.CIRCUIT_BREAKER_THRESHOLD.code
    );

    let transitionDetected = false;
    const updateLogic = (state: CircuitBreakerStateData) => {
      const alreadyOpen = state.state === 'open';
      const now = Date.now();
      state.failures = state.failures.filter((f) => now - f.timestamp < windowMs);
      state.failures.push({ timestamp: now, type });
      state.lastFailureTime = now;

      if (
        state.state === 'half_open' ||
        (state.state === 'closed' && state.failures.length >= threshold)
      ) {
        state.state = 'open';
        state.lastStateChange = now;
        state.halfOpenProbes = 0;
        if (!alreadyOpen) transitionDetected = true;
      }
      return state;
    };

    const initialState = await this.loadState();
    const finalState = await this.saveStateWithRetry(updateLogic({ ...initialState }), updateLogic);

    if (transitionDetected) {
      await this.logStateChange(finalState, type, ctx);
      try {
        const { emitMetrics, METRICS } = await import('../metrics');
        await emitMetrics([
          METRICS.circuitBreakerTriggered(type as 'deploy' | 'recovery' | 'gap' | 'event'),
        ]);
      } catch {
        // Metrics emission failure should not block circuit breaker operation
      }
    }

    return finalState;
  }

  private async logStateChange(state: CircuitBreakerStateData, type: string, ctx?: any) {
    if (ctx?.traceId) {
      await addTraceStep(ctx.traceId, 'root', {
        type: TRACE_TYPES.CIRCUIT_BREAKER,
        content: { newState: state.state, failureType: type, key: this.stateKey },
      });
    }
    if (state.state === 'open' && ctx?.userId) {
      await reportHealthIssue({
        component: 'CircuitBreaker',
        issue: `Circuit breaker ${this.stateKey} opened.`,
        severity: 'high',
        userId: ctx.userId,
      });
    }
  }

  async recordSuccess(ctx?: {
    userId?: string;
    traceId?: string;
  }): Promise<CircuitBreakerStateData> {
    let transitionDetected = false;
    const updateLogic = (state: CircuitBreakerStateData) => {
      if (state.state === 'half_open') {
        state.state = 'closed';
        state.lastStateChange = Date.now();
        state.halfOpenProbes = 0;
        state.failures = [];
        transitionDetected = true;
      }
      return state;
    };
    const initialState = await this.loadState();
    const finalState = await this.saveStateWithRetry(updateLogic({ ...initialState }), updateLogic);

    if (transitionDetected) {
      await this.logStateChange(finalState, 'recovery', ctx);
    }

    return finalState;
  }

  async canProceed(deployType: 'autonomous' | 'emergency'): Promise<CanProceedResult> {
    let state = await this.loadState();
    if (deployType === 'emergency') return this.handleEmergencyBypass(state);

    if (state.state === 'open') {
      const cooldown = await this.getConfig(
        'circuit_breaker_cooldown_ms',
        CONFIG_DEFAULTS.CIRCUIT_BREAKER_COOLDOWN_MS.code
      );
      if (Date.now() - state.lastStateChange < cooldown) {
        return {
          allowed: false,
          state: 'open',
          failureCount: state.failures.length,
          reason: 'Cooldown active',
        };
      }
      const updateLogic = (s: CircuitBreakerStateData) => {
        s.state = 'half_open';
        s.lastStateChange = Date.now();
        return s;
      };
      state = await this.saveStateWithRetry(updateLogic({ ...state }), updateLogic);
    }

    if (state.state === 'half_open') {
      const maxProbes = await this.getConfig(
        'circuit_breaker_half_open_max',
        CONFIG_DEFAULTS.CIRCUIT_BREAKER_HALF_OPEN_MAX.code
      );
      if (state.halfOpenProbes >= maxProbes)
        return {
          allowed: false,
          state: 'half_open',
          failureCount: state.failures.length,
          reason: 'Max probes exhausted',
        };

      const probeUpdate = (s: CircuitBreakerStateData) => {
        s.halfOpenProbes++;
        return s;
      };
      state = await this.saveStateWithRetry(probeUpdate({ ...state }), probeUpdate);
      return {
        allowed: true,
        state: 'half_open',
        failureCount: state.failures.length,
        reason: 'HALF_OPEN_PROBE',
      };
    }

    return { allowed: true, state: state.state, failureCount: state.failures.length };
  }

  private async handleEmergencyBypass(state: CircuitBreakerStateData): Promise<CanProceedResult> {
    const limit = await this.getConfig(
      'circuit_breaker_emergency_rate_limit',
      CONFIG_DEFAULTS.CIRCUIT_BREAKER_EMERGENCY_RATE_LIMIT.code
    );
    const now = Date.now();
    if (now - state.emergencyDeployWindowStart > 3600000) {
      state.emergencyDeployCount = 0;
      state.emergencyDeployWindowStart = now;
    }
    if (state.emergencyDeployCount >= limit)
      return {
        allowed: false,
        state: state.state,
        failureCount: state.failures.length,
        reason: 'EMERGENCY_RATE_LIMIT_EXCEEDED',
      };

    const bypassUpdate = (s: CircuitBreakerStateData) => {
      s.emergencyDeployCount++;
      return s;
    };
    const finalState = await this.saveStateWithRetry(bypassUpdate({ ...state }), bypassUpdate);
    return {
      allowed: true,
      state: finalState.state,
      failureCount: finalState.failures.length,
      reason: 'EMERGENCY_BYPASS_WITH_RATE_LIMIT',
    };
  }

  private async getConfig(key: string, defaultValue: number): Promise<number> {
    const { ConfigManager } = await import('../registry/config');
    return await ConfigManager.getTypedConfig(key, defaultValue);
  }

  async reset(): Promise<void> {
    await this.saveStateWithRetry(this.freshState());
  }
}

const _instances = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(key: string = 'circuit_breaker_state'): CircuitBreaker {
  if (!_instances.has(key)) _instances.set(key, new CircuitBreaker(key));
  return _instances.get(key)!;
}

export function resetCircuitBreakerInstance(key?: string): void {
  if (key) _instances.delete(key);
  else _instances.clear();
}
