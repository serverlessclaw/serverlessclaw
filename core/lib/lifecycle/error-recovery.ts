/**
 * @module ErrorRecovery
 * @description Enhanced error recovery with exponential backoff, error classification,
 * and fallback mechanisms. Integrates with existing circuit breaker pattern.
 */

import { logger } from '../logger';
import { getCircuitBreaker } from '../safety/circuit-breaker';

/**
 * Error classification for determining recovery strategy.
 */
export enum ErrorClass {
  /** Transient errors that may succeed on retry (network, rate limit, timeout) */
  TRANSIENT = 'transient',
  /** Permanent errors that won't succeed on retry (invalid input, auth failure) */
  PERMANENT = 'permanent',
  /** Unknown errors - assume transient with caution */
  UNKNOWN = 'unknown',
}

/**
 * Recovery strategy based on error class.
 */
export interface RecoveryStrategy {
  /** Should we retry this error? */
  shouldRetry: boolean;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay in ms for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs: number;
  /** Should we use jitter to prevent thundering herd? */
  useJitter: boolean;
  /** Fallback function if all retries fail */
  fallback?: () => Promise<unknown>;
}

/**
 * Result of a recovery attempt.
 */
export interface RecoveryResult<T> {
  /** Whether the operation eventually succeeded */
  success: boolean;
  /** The result if successful */
  result?: T;
  /** The error if failed */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Total time spent in ms */
  totalTimeMs: number;
  /** Whether we used a fallback */
  usedFallback: boolean;
}

/**
 * Patterns for error classification.
 */
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /network/i,
  /rate.?limit/i,
  /throttl/i,
  /429/,
  /503/,
  /502/,
  /504/,
  /temporarily/i,
  /retry/i,
  /busy/i,
  /overload/i,
  /capacity/i,
];

const PERMANENT_PATTERNS = [
  /invalid/i,
  /malformed/i,
  /unauthorized/i,
  /forbidden/i,
  /401/,
  /403/,
  /404/,
  /not.?found/i,
  /already.?exists/i,
  /conflict/i,
  /validation/i,
  /schema/i,
  /parse/i,
  /syntax/i,
];

/**
 * Helper to identify connection-related errors.
 */
export function isConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('connection') ||
      msg.includes('econnrefused') ||
      msg.includes('socket') ||
      msg.includes('closed') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout')
    );
  }
  return false;
}

/**
 * Classifies an error as transient, permanent, or unknown.
 */
export function classifyError(error: Error | string | Record<string, unknown>): ErrorClass {
  const message = typeof error === 'string' ? error : (error as Error).message || '';
  const name = error instanceof Error ? error.name : '';
  const status =
    ((error as Record<string, unknown>)?.status as number) ||
    ((error as Record<string, unknown>)?.statusCode as number) ||
    0;

  // Check HTTP status codes first if available
  if (status >= 500 || status === 429) {
    return ErrorClass.TRANSIENT;
  }
  if (status >= 400 && status < 500) {
    return ErrorClass.PERMANENT;
  }

  // Check permanent patterns (more specific)
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(message) || pattern.test(name)) {
      return ErrorClass.PERMANENT;
    }
  }

  // Check connection errors (always transient)
  if (isConnectionError(error)) {
    return ErrorClass.TRANSIENT;
  }

  // Check transient patterns
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(message) || pattern.test(name)) {
      return ErrorClass.TRANSIENT;
    }
  }

  // Check for specific AWS/DynamoDB errors by name or message
  if (error instanceof Error || typeof error === 'object') {
    const errorName = error?.name || '';
    if (
      errorName === 'ConditionalCheckFailedException' ||
      message.includes('ConditionalCheckFailedException')
    ) {
      return ErrorClass.TRANSIENT; // Concurrent update, can retry
    }
    if (
      errorName === 'ProvisionedThroughputExceededException' ||
      message.includes('ProvisionedThroughputExceededException')
    ) {
      return ErrorClass.TRANSIENT;
    }
    if (errorName === 'RequestLimitExceeded' || message.includes('RequestLimitExceeded')) {
      return ErrorClass.TRANSIENT;
    }
    if (errorName === 'ValidationException' || message.includes('ValidationException')) {
      return ErrorClass.PERMANENT;
    }
    if (
      errorName === 'ResourceNotFoundException' ||
      message.includes('ResourceNotFoundException')
    ) {
      return ErrorClass.PERMANENT;
    }
  }

  return ErrorClass.UNKNOWN;
}

/**
 * Gets recovery strategy based on error class.
 *
 * @param errorClass The classification of the error (transient, permanent, unknown).
 * @param overrides Optional partial strategy to override defaults.
 */
export function getRecoveryStrategy(
  errorClass: ErrorClass,
  overrides?: Partial<RecoveryStrategy>
): RecoveryStrategy {
  const defaults: Record<ErrorClass, RecoveryStrategy> = {
    [ErrorClass.TRANSIENT]: {
      shouldRetry: true,
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      useJitter: true,
    },
    [ErrorClass.PERMANENT]: {
      shouldRetry: false,
      maxRetries: 0,
      baseDelayMs: 0,
      maxDelayMs: 0,
      useJitter: false,
    },
    [ErrorClass.UNKNOWN]: {
      shouldRetry: true,
      maxRetries: 2,
      baseDelayMs: 2000,
      maxDelayMs: 15000,
      useJitter: true,
    },
  };

  return { ...defaults[errorClass], ...overrides };
}

/**
 * Calculates delay with exponential backoff and optional jitter.
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  useJitter: boolean = true
): number {
  // Exponential backoff: base * 2^attempt
  let delay = baseDelayMs * Math.pow(2, attempt);

  // Cap at max
  delay = Math.min(delay, maxDelayMs);

  // Add jitter (±25%) to prevent thundering herd
  if (useJitter) {
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);
  }

  return Math.floor(delay);
}

/**
 * Sleeps for the specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a function with retry logic and exponential backoff.
 *
 * @param fn The asynchronous function to execute.
 * @param options Retry configuration options.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    useJitter?: boolean;
    onRetry?: (attempt: number, error: Error, delayMs: number) => void;
    fallback?: () => Promise<T>;
    operationName?: string;
  }
): Promise<RecoveryResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    useJitter = true,
    onRetry,
    fallback,
    operationName = 'operation',
  } = options ?? {};

  const startTime = Date.now();
  let lastError: Error | undefined;
  let actualAttempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    actualAttempts = attempt + 1;
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: actualAttempts,
        totalTimeMs: Date.now() - startTime,
        usedFallback: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorClass = classifyError(lastError);

      logger.warn(
        `[ErrorRecovery] ${operationName} failed (attempt ${actualAttempts}/${maxRetries + 1}): ${lastError.message} [${errorClass}]`
      );

      // Don't retry permanent errors - exit immediately
      if (errorClass === ErrorClass.PERMANENT) {
        logger.info(`[ErrorRecovery] ${operationName}: Permanent error detected, not retrying`);
        break;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      // Calculate backoff and wait
      const delay = calculateBackoff(attempt, baseDelayMs, maxDelayMs, useJitter);
      onRetry?.(actualAttempts, lastError, delay);
      await sleep(delay);
    }
  }

  // Try fallback if available
  if (fallback) {
    try {
      logger.info(
        `[ErrorRecovery] ${operationName} attempting fallback after ${actualAttempts} failures`
      );
      const result = await fallback();
      return {
        success: true,
        result,
        attempts: actualAttempts,
        totalTimeMs: Date.now() - startTime,
        usedFallback: true,
      };
    } catch (fallbackError) {
      logger.error(`[ErrorRecovery] ${operationName} fallback also failed:`, fallbackError);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: actualAttempts,
    totalTimeMs: Date.now() - startTime,
    usedFallback: false,
  };
}

/**
 * Enhanced retry with automatic error classification and circuit breaker.
 */
export async function withResilientExecution<T>(
  fn: () => Promise<T>,
  options: {
    operationName: string;
    circuitBreakerType?: 'deploy' | 'health';
    fallback?: () => Promise<T>;
    onRetry?: (attempt: number, error: Error, delayMs: number) => void;
    maxRetries?: number;
    baseDelayMs?: number;
  }
): Promise<T> {
  const {
    operationName,
    circuitBreakerType,
    fallback,
    onRetry,
    maxRetries = 3,
    baseDelayMs = 1000,
  } = options;

  const circuitBreaker = getCircuitBreaker();

  // Check circuit breaker if type specified
  if (circuitBreakerType) {
    const canProceed = await circuitBreaker.canProceed('autonomous');
    if (!canProceed.allowed) {
      throw new Error(`Circuit breaker is ${canProceed.state}: ${canProceed.reason}`);
    }
  }

  const result = await withRetry(fn, {
    maxRetries,
    baseDelayMs,
    operationName,
    fallback,
    onRetry: (attempt, error, delay) => {
      // Record failure with circuit breaker on each retry
      if (circuitBreakerType) {
        circuitBreaker.recordFailure(circuitBreakerType).catch((e) => {
          logger.warn('Failed to record circuit breaker failure:', e);
        });
      }
      onRetry?.(attempt, error, delay);
    },
  });

  if (result.success) {
    // Record success with circuit breaker
    if (circuitBreakerType) {
      await circuitBreaker.recordSuccess().catch((e) => {
        logger.warn('Failed to record circuit breaker success:', e);
      });
    }

    if (result.usedFallback) {
      logger.info(`[ErrorRecovery] ${operationName} succeeded via fallback`);
    }

    return result.result!;
  }

  // All attempts failed
  const errorMessage = `[ErrorRecovery] ${operationName} failed after ${result.attempts} attempts (${result.totalTimeMs}ms)`;
  logger.error(errorMessage, result.error);

  throw result.error ?? new Error(errorMessage);
}

/**
 * Provider-specific recovery with model fallback.
 *
 * @param providers Array of providers with their names and execution functions.
 * @param options Fallback configuration options.
 */
export async function withProviderFallback<T>(
  providers: Array<{ name: string; fn: () => Promise<T> }>,
  options?: {
    operationName?: string;
    maxRetriesPerProvider?: number;
  }
): Promise<T> {
  const { operationName = 'provider-call', maxRetriesPerProvider = 2 } = options ?? {};

  let lastError: Error | undefined;

  for (const provider of providers) {
    const result = await withRetry(provider.fn, {
      maxRetries: maxRetriesPerProvider,
      operationName: `${operationName}(${provider.name})`,
    });

    if (result.success) {
      return result.result!;
    }

    lastError = result.error;
    logger.warn(`[ErrorRecovery] Provider ${provider.name} failed, trying next...`);
  }

  throw lastError ?? new Error(`All providers failed for ${operationName}`);
}

/**
 * Circuit breaker aware MCP tool execution.
 *
 * @param toolName The name of the MCP tool being executed.
 * @param execute The function that performs the tool call.
 * @param options Resilience options including fallback and failure callback.
 */
export async function withMCPResilience<T>(
  toolName: string,
  execute: () => Promise<T>,
  options: {
    fallback?: () => Promise<T>;
    onFailure?: (error: Error) => void | Promise<void>;
  } = {}
): Promise<T> {
  return withResilientExecution(execute, {
    operationName: `mcp:${toolName}`,
    // Decoupled from global circuit breaker to prevent tool failures from blocking all autonomous actions.
    // Tool-specific circuit breaking is handled by MCPClientManager and its persistent health tracking.
    circuitBreakerType: undefined,
    fallback: options.fallback,
    maxRetries: 2,
    baseDelayMs: 500,
    onRetry: async (_attempt, error) => {
      if (options.onFailure) {
        await options.onFailure(error);
      }
    },
  });
}

/**
 * Gets current error recovery statistics.
 */
export function getRecoveryStats(): {
  circuitBreakerState: Promise<string>;
} {
  const cb = getCircuitBreaker();
  return {
    circuitBreakerState: cb.getState().then((s) => s.state),
  };
}
