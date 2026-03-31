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
} from './error-recovery';

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
  });

  describe('unknown errors', () => {
    it('should classify unrecognized errors as unknown', () => {
      expect(classifyError(new Error('Something went wrong'))).toBe(ErrorClass.UNKNOWN);
      expect(classifyError('Unknown error')).toBe(ErrorClass.UNKNOWN);
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
  });

  it('should return cautious strategy for unknown errors', () => {
    const strategy = getRecoveryStrategy(ErrorClass.UNKNOWN);
    expect(strategy.shouldRetry).toBe(true);
    expect(strategy.maxRetries).toBe(2);
  });

  it('should allow overrides', () => {
    const strategy = getRecoveryStrategy(ErrorClass.TRANSIENT, { maxRetries: 5 });
    expect(strategy.maxRetries).toBe(5);
  });
});

describe('calculateBackoff', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // Fixed jitter for predictable tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should calculate exponential backoff', () => {
    const delay0 = calculateBackoff(0, 1000, 30000, false);
    const delay1 = calculateBackoff(1, 1000, 30000, false);
    const delay2 = calculateBackoff(2, 1000, 30000, false);

    expect(delay0).toBe(1000); // 1000 * 2^0
    expect(delay1).toBe(2000); // 1000 * 2^1
    expect(delay2).toBe(4000); // 1000 * 2^2
  });

  it('should cap at max delay', () => {
    const delay = calculateBackoff(10, 1000, 5000, false);
    expect(delay).toBe(5000);
  });

  it('should add jitter when enabled', () => {
    const delay = calculateBackoff(0, 1000, 30000, true);
    // With random = 0.5, jitter = 0 (middle of ±25% range)
    expect(delay).toBe(1000);
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
});

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { operationName: 'test' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('success');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient errors', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10, // Very short delay for test
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
      baseDelayMs: 10, // Very short delay for test
      operationName: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // 1 initial + 2 retries
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
});
