import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockSend, mockGetTypedConfig } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetTypedConfig: vi.fn(),
}));

vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => ({
        name: `test-${String(prop).toLowerCase()}`,
      }),
    }
  ),
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./registry/config', () => ({
  ConfigManager: {
    getTypedConfig: mockGetTypedConfig,
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({
        send: mockSend,
      }),
    },
  };
});

vi.mock('./health', () => ({
  reportHealthIssue: vi.fn().mockResolvedValue({}),
}));

import { getCircuitBreaker, resetCircuitBreakerInstance } from './circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    resetCircuitBreakerInstance();
    mockGetTypedConfig.mockImplementation((key: string, fallback: number) => {
      if (key === 'circuit_breaker_threshold') return 3;
      if (key === 'circuit_breaker_window_ms') return 3600000;
      if (key === 'circuit_breaker_cooldown_ms') return 600000;
      if (key === 'circuit_breaker_half_open_max') return 1;
      return fallback;
    });
  });

  it('should open after threshold failures in window', async () => {
    const cb = getCircuitBreaker();

    mockSend.mockResolvedValueOnce({ Item: null });
    mockSend.mockResolvedValueOnce({});

    await cb.recordFailure('deploy', { userId: 'u1' });

    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'closed',
          failures: [{ timestamp: Date.now() - 100, type: 'deploy' }],
          lastStateChange: Date.now() - 1000,
          version: 2,
        },
      },
    });
    mockSend.mockResolvedValueOnce({});

    await cb.recordFailure('deploy', { userId: 'u1' });

    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'closed',
          failures: [
            { timestamp: Date.now() - 200, type: 'deploy' },
            { timestamp: Date.now() - 100, type: 'deploy' },
          ],
          lastStateChange: Date.now() - 1000,
          version: 3,
        },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const state = await cb.recordFailure('deploy', { userId: 'u1' });
    expect(state.state).toBe('open');

    const { reportHealthIssue } = await import('./health');
    expect(reportHealthIssue).toHaveBeenCalled();
  });

  it('should retry on concurrent update conflicts', async () => {
    const cb = getCircuitBreaker();
    const conflictError = Object.create(Error.prototype);
    conflictError.message = 'ConditionalCheckFailedException: Conflict — concurrently modified';
    Object.defineProperty(conflictError, 'name', {
      value: 'ConditionalCheckFailedException',
      writable: true,
      enumerable: false,
      configurable: true,
    });

    mockSend.mockResolvedValueOnce({
      Item: { value: { state: 'closed', failures: [], version: 1 } },
    });
    mockSend.mockRejectedValueOnce(conflictError);
    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'closed',
          failures: [{ timestamp: Date.now(), type: 'deploy' }],
          version: 2,
        },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const state = await cb.recordFailure('deploy', { userId: 'u1' });
    expect(state.version).toBe(3);
    expect(state.failures.length).toBe(2);
  });

  it('should transition from open to half-open after cooldown', async () => {
    const cb = getCircuitBreaker();

    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'open',
          failures: [{ timestamp: Date.now() - 700000, type: 'deploy' }],
          lastStateChange: Date.now() - 700000,
          halfOpenProbes: 0,
          version: 10,
        },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const proceed = await cb.canProceed('autonomous');
    expect(proceed.allowed).toBe(true);
    expect(proceed.reason).toBe('HALF_OPEN_PROBE');
  });

  it('should block autonomous deploys when open and in cooldown', async () => {
    const cb = getCircuitBreaker();

    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'open',
          failures: [{ timestamp: Date.now() - 100000, type: 'deploy' }],
          lastStateChange: Date.now() - 100000,
          halfOpenProbes: 0,
          version: 10,
        },
      },
    });

    const proceed = await cb.canProceed('autonomous');
    expect(proceed.allowed).toBe(false);
    expect(proceed.reason).toContain('Cooldown active');
  });

  it('should allow emergency deploys even when open', async () => {
    const cb = getCircuitBreaker();

    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'open',
          failures: [{ timestamp: Date.now() - 100000, type: 'deploy' }],
          lastStateChange: Date.now() - 100000,
          halfOpenProbes: 0,
          version: 10,
        },
      },
    });

    const proceed = await cb.canProceed('emergency');
    expect(proceed.allowed).toBe(true);
    expect(proceed.reason).toBe('EMERGENCY_BYPASS');
  });

  it('should close after successful probe in half-open state', async () => {
    const cb = getCircuitBreaker();

    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'half_open',
          failures: [{ timestamp: Date.now() - 100000, type: 'deploy' }],
          lastStateChange: Date.now() - 100000,
          halfOpenProbes: 1,
          version: 15,
        },
      },
    });
    mockSend.mockResolvedValueOnce({});

    const state = await cb.recordSuccess();
    expect(state.state).toBe('closed');
    expect(state.failures.length).toBe(0);
  });
});
