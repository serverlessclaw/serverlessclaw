/**
 * @module ErrorRecovery Tests
 * @description Unit tests for error recovery with exponential backoff and error classification.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyError,
  ErrorClass,
  getRecoveryStrategy,
  calculateBackoff,
  withRetry,
  sleep,
  withResilientExecution,
  withProviderFallback,
  withMCPResilience,
  getRecoveryStats,
} from './error-recovery';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { mockCanProceed, mockRecordFailure, mockRecordSuccess, mockGetState } = vi.hoisted(() => ({
  mockCanProceed: vi.fn(),
  mockRecordFailure: vi.fn(),
  mockRecordSuccess: vi.fn(),
  mockGetState: vi.fn(),
}));

vi.mock('../safety/circuit-breaker', () => ({
  getCircuitBreaker: vi.fn(() => ({
    canProceed: mockCanProceed,
    recordFailure: mockRecordFailure,
    recordSuccess: mockRecordSuccess,
    getState: mockGetState,
  })),
}));

describe('classifyError', () => {
  describe('transient errors', () => {
    it('should classify timeout errors as transient', () => {
      expect(classifyError(new Error('Connection timeout'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError('ETIMEDOUT')).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify network errors as transient', () => {
      expect(classifyError(new Error('ECONNRESET'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('ECONNREFUSED'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('Network error'))).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify rate limit errors as transient', () => {
      expect(classifyError(new Error('Rate limit exceeded'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('Too many requests (429)'))).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify server errors as transient', () => {
      expect(classifyError(new Error('Service unavailable (503)'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('Bad gateway (502)'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('Gateway timeout (504)'))).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify AWS DynamoDB transient errors', () => {
      expect(classifyError(new Error('ConditionalCheckFailedException'))).toBe(
        ErrorClass.TRANSIENT
      );
      expect(classifyError(new Error('ProvisionedThroughputExceededException'))).toBe(
        ErrorClass.TRANSIENT
      );
      expect(classifyError(new Error('RequestLimitExceeded'))).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify HTTP 5xx status as transient', () => {
      expect(classifyError({ status: 500, message: 'Internal' } as any)).toBe(ErrorClass.TRANSIENT);
      expect(classifyError({ statusCode: 503, message: 'Unavailable' } as any)).toBe(
        ErrorClass.TRANSIENT
      );
    });

    it('should classify throttling errors as transient', () => {
      expect(classifyError(new Error('Request was throttled'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('Server busy'))).toBe(ErrorClass.TRANSIENT);
      expect(classifyError(new Error('System overload'))).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify temporarily unavailable as transient', () => {
      expect(classifyError(new Error('Service temporarily unavailable'))).toBe(
        ErrorClass.TRANSIENT
      );
    });

    it('should classify retry errors as transient', () => {
      expect(classifyError(new Error('Please retry later'))).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify capacity errors as transient', () => {
      expect(classifyError(new Error('At capacity'))).toBe(ErrorClass.TRANSIENT);
    });
  });

  describe('permanent errors', () => {
    it('should classify validation errors as permanent', () => {
      expect(classifyError(new Error('Invalid input'))).toBe(ErrorClass.PERMANENT);
      expect(classifyError(new Error('ValidationException'))).toBe(ErrorClass.PERMANENT);
      expect(classifyError(new Error('Schema validation failed'))).toBe(ErrorClass.PERMANENT);
    });

    it('should classify auth errors as permanent', () => {
      expect(classifyError(new Error('Unauthorized (401)'))).toBe(ErrorClass.PERMANENT);
      expect(classifyError(new Error('Forbidden (403)'))).toBe(ErrorClass.PERMANENT);
    });

    it('should classify not found errors as permanent', () => {
      expect(classifyError(new Error('Not found (404)'))).toBe(ErrorClass.PERMANENT);
      expect(classifyError(new Error('ResourceNotFoundException'))).toBe(ErrorClass.PERMANENT);
    });

    it('should classify conflict errors as permanent', () => {
      expect(classifyError(new Error('Already exists'))).toBe(ErrorClass.PERMANENT);
      expect(classifyError(new Error('Conflict'))).toBe(ErrorClass.PERMANENT);
    });

    it('should classify HTTP 4xx status as permanent', () => {
      expect(classifyError({ status: 400, message: 'Bad request' } as any)).toBe(
        ErrorClass.PERMANENT
      );
      expect(classifyError({ statusCode: 404, message: 'Not found' } as any)).toBe(
        ErrorClass.PERMANENT
      );
    });

    it('should classify parse/syntax errors as permanent', () => {
      expect(classifyError(new Error('Parse error'))).toBe(ErrorClass.PERMANENT);
      expect(classifyError(new Error('Syntax error in query'))).toBe(ErrorClass.PERMANENT);
    });

    it('should classify malformed errors as permanent', () => {
      expect(classifyError(new Error('Malformed JSON'))).toBe(ErrorClass.PERMANENT);
    });
  });

  describe('unknown errors', () => {
    it('should classify unrecognized errors as unknown', () => {
      expect(classifyError(new Error('Something went wrong'))).toBe(ErrorClass.UNKNOWN);
      expect(classifyError('Unknown error')).toBe(ErrorClass.UNKNOWN);
    });

    it('should classify empty error as unknown', () => {
      expect(classifyError(new Error(''))).toBe(ErrorClass.UNKNOWN);
    });

    it('should classify object without matching patterns as unknown', () => {
      expect(classifyError({ message: 'weird stuff' } as any)).toBe(ErrorClass.UNKNOWN);
    });
  });

  describe('named errors', () => {
    it('should classify ConditionalCheckFailedException by name', () => {
      const error = new Error('check failed');
      error.name = 'ConditionalCheckFailedException';
      expect(classifyError(error)).toBe(ErrorClass.TRANSIENT);
    });

    it('should classify ValidationException by name', () => {
      const error = new Error('bad input');
      error.name = 'ValidationException';
      expect(classifyError(error)).toBe(ErrorClass.PERMANENT);
    });

    it('should classify ResourceNotFoundException by name', () => {
      const error = new Error('missing');
      error.name = 'ResourceNotFoundException';
      expect(classifyError(error)).toBe(ErrorClass.PERMANENT);
    });
  });
});

describe('getRecoveryStrategy', () => {
  it('should return retry strategy for transient errors', () => {
    const strategy = getRecoveryStrategy(ErrorClass.TRANSIENT);
    expect(strategy.shouldRetry).toBe(true);
    expect(strategy.maxRetries).toBe(3);
    expect(strategy.baseDelayMs).toBe(1000);
    expect(strategy.useJitter).toBe(true);
  });

  it('should return no-retry strategy for permanent errors', () => {
    const strategy = getRecoveryStrategy(ErrorClass.PERMANENT);
    expect(strategy.shouldRetry).toBe(false);
    expect(strategy.maxRetries).toBe(0);
    expect(strategy.baseDelayMs).toBe(0);
  });

  it('should return cautious strategy for unknown errors', () => {
    const strategy = getRecoveryStrategy(ErrorClass.UNKNOWN);
    expect(strategy.shouldRetry).toBe(true);
    expect(strategy.maxRetries).toBe(2);
    expect(strategy.baseDelayMs).toBe(2000);
  });

  it('should allow overrides', () => {
    const strategy = getRecoveryStrategy(ErrorClass.TRANSIENT, { maxRetries: 5 });
    expect(strategy.maxRetries).toBe(5);
    expect(strategy.baseDelayMs).toBe(1000);
  });

  it('should allow multiple overrides', () => {
    const strategy = getRecoveryStrategy(ErrorClass.TRANSIENT, {
      maxRetries: 10,
      baseDelayMs: 500,
      useJitter: false,
    });
    expect(strategy.maxRetries).toBe(10);
    expect(strategy.baseDelayMs).toBe(500);
    expect(strategy.useJitter).toBe(false);
  });
});

describe('calculateBackoff', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should calculate exponential backoff', () => {
    const delay0 = calculateBackoff(0, 1000, 30000, false);
    const delay1 = calculateBackoff(1, 1000, 30000, false);
    const delay2 = calculateBackoff(2, 1000, 30000, false);

    expect(delay0).toBe(1000);
    expect(delay1).toBe(2000);
    expect(delay2).toBe(4000);
  });

  it('should cap at max delay', () => {
    const delay = calculateBackoff(10, 1000, 5000, false);
    expect(delay).toBe(5000);
  });

  it('should add jitter when enabled', () => {
    const delay = calculateBackoff(0, 1000, 30000, true);
    expect(delay).toBe(1000);
  });

  it('should produce non-negative delay with jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const delay = calculateBackoff(0, 1000, 30000, true);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('should produce reasonable delay with high jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const delay = calculateBackoff(0, 1000, 10000, true);
    expect(delay).toBeLessThanOrEqual(10000);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('should default useJitter to true', () => {
    const delay = calculateBackoff(0, 1000, 30000);
    expect(typeof delay).toBe('number');
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve after specified time', async () => {
    const promise = sleep(1000);

    vi.advanceTimersByTime(999);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await promise;

    expect(resolved).toBe(true);
  });

  it('should resolve immediately with 0ms', async () => {
    const promise = sleep(0);
    vi.advanceTimersByTime(0);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { operationName: 'test' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.usedFallback).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient errors', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      operationName: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on permanent errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid input'));

    const result = await withRetry(fn, {
      maxRetries: 3,
      operationName: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should exhaust retries on persistent transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 10,
      operationName: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should call fallback when all retries fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const fallback = vi.fn().mockResolvedValue('fallback-result');

    const result = await withRetry(fn, {
      maxRetries: 1,
      baseDelayMs: 10,
      fallback,
      operationName: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('fallback-result');
    expect(result.usedFallback).toBe(true);
    expect(fallback).toHaveBeenCalled();
  });

  it('should handle fallback failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const fallback = vi.fn().mockRejectedValue(new Error('fallback failed'));

    const result = await withRetry(fn, {
      maxRetries: 1,
      baseDelayMs: 10,
      fallback,
      operationName: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.usedFallback).toBe(false);
  });

  it('should call onRetry callback', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('success');
    const onRetry = vi.fn();

    await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      onRetry,
      operationName: 'test',
    });

    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
  });

  it('should track total time', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      operationName: 'test',
    });

    expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should wrap non-Error thrown values', async () => {
    const fn = vi.fn().mockRejectedValueOnce('string error').mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxRetries: 1,
      baseDelayMs: 10,
      operationName: 'test',
    });

    expect(result.success).toBe(true);
  });

  it('should use default options', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should not call fallback if no fallback provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    const result = await withRetry(fn, {
      maxRetries: 0,
      baseDelayMs: 10,
      operationName: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.usedFallback).toBe(false);
  });
});

describe('withResilientExecution', () => {
  beforeEach(() => {
    mockCanProceed.mockResolvedValue({ allowed: true, state: 'closed' });
    mockRecordFailure.mockResolvedValue(undefined);
    mockRecordSuccess.mockResolvedValue(undefined);
  });

  it('should execute successfully without circuit breaker', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    const result = await withResilientExecution(fn, { operationName: 'test-op' });

    expect(result).toBe('result');
  });

  it('should check circuit breaker when type specified', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    await withResilientExecution(fn, {
      operationName: 'test-op',
      circuitBreakerType: 'deploy',
    });

    expect(mockCanProceed).toHaveBeenCalledWith('autonomous');
  });

  it('should throw when circuit breaker disallows', async () => {
    mockCanProceed.mockResolvedValue({
      allowed: false,
      state: 'open',
      reason: 'Too many failures',
    });

    const fn = vi.fn().mockResolvedValue('result');

    await expect(
      withResilientExecution(fn, {
        operationName: 'test-op',
        circuitBreakerType: 'deploy',
      })
    ).rejects.toThrow('Circuit breaker is open');
  });

  it('should record success with circuit breaker', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    await withResilientExecution(fn, {
      operationName: 'test-op',
      circuitBreakerType: 'health',
    });

    expect(mockRecordSuccess).toHaveBeenCalled();
  });

  it('should use fallback on failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const fallback = vi.fn().mockResolvedValue('fallback-val');

    const result = await withResilientExecution(fn, {
      operationName: 'test-op',
      fallback,
      maxRetries: 1,
      baseDelayMs: 10,
    });

    expect(result).toBe('fallback-val');
  });

  it('should throw when all attempts fail without fallback', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      withResilientExecution(fn, {
        operationName: 'test-op',
        maxRetries: 1,
        baseDelayMs: 10,
      })
    ).rejects.toThrow('timeout');
  });
});

describe('withProviderFallback', () => {
  it('should succeed with first provider', async () => {
    const fn1 = vi.fn().mockResolvedValue('result-1');
    const fn2 = vi.fn().mockResolvedValue('result-2');

    const result = await withProviderFallback([
      { name: 'provider-1', fn: fn1 },
      { name: 'provider-2', fn: fn2 },
    ]);

    expect(result).toBe('result-1');
    expect(fn2).not.toHaveBeenCalled();
  });

  it('should fall through to next provider on failure', async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error('timeout'));
    const fn2 = vi.fn().mockResolvedValue('result-2');

    const result = await withProviderFallback([
      { name: 'provider-1', fn: fn1 },
      { name: 'provider-2', fn: fn2 },
    ]);

    expect(result).toBe('result-2');
  });

  it('should throw when all providers fail', async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error('Invalid input'));
    const fn2 = vi.fn().mockRejectedValue(new Error('Invalid input'));

    await expect(
      withProviderFallback(
        [
          { name: 'provider-1', fn: fn1 },
          { name: 'provider-2', fn: fn2 },
        ],
        { maxRetriesPerProvider: 0 }
      )
    ).rejects.toThrow();
  }, 10000);

  it('should use custom operation name', async () => {
    const fn1 = vi.fn().mockResolvedValue('ok');

    const result = await withProviderFallback([{ name: 'p1', fn: fn1 }], {
      operationName: 'custom-op',
    });

    expect(result).toBe('ok');
  });

  it('should respect maxRetriesPerProvider', async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      withProviderFallback([{ name: 'p1', fn: fn1 }], {
        maxRetriesPerProvider: 0,
      })
    ).rejects.toThrow();
  });
});

describe('withMCPResilience', () => {
  beforeEach(() => {
    mockCanProceed.mockResolvedValue({ allowed: true, state: 'closed' });
    mockRecordSuccess.mockResolvedValue(undefined);
  });

  it('should execute MCP tool successfully', async () => {
    const execute = vi.fn().mockResolvedValue('mcp-result');

    const result = await withMCPResilience('my-tool', execute);

    expect(result).toBe('mcp-result');
  });

  it('should use fallback on failure', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('timeout'));
    const fallback = vi.fn().mockResolvedValue('fallback-result');

    const result = await withMCPResilience('my-tool', execute, fallback);

    expect(result).toBe('fallback-result');
  });
});

describe('getRecoveryStats', () => {
  it('should return circuit breaker state', async () => {
    mockGetState.mockResolvedValue({ state: 'closed' });

    const stats = getRecoveryStats();
    const state = await stats.circuitBreakerState;

    expect(state).toBe('closed');
  });
});
