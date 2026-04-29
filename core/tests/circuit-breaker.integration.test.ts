import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCircuitBreaker, resetCircuitBreakerInstance } from '../lib/safety/circuit-breaker';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: mockSend,
    }),
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('../lib/utils/ddb-client', () => ({
  getDocClient: () => ({ send: mockSend }),
  getConfigTableName: () => 'test-config-table',
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi
      .fn()
      .mockImplementation((key, defaultValue) => Promise.resolve(defaultValue)),
  },
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Circuit Breaker Integration', () => {
  const cb = getCircuitBreaker('test-cb', 'ws-123');

  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreakerInstance('test-cb');
  });

  it('should open after threshold failures', async () => {
    // 1. Initial state: closed, already has 4 failures (threshold is 5)
    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'closed',
          failures: Array(4).fill({ timestamp: Date.now() - 1000, type: 'timeout' }),
          version: 1,
        },
      },
    });
    // 2. Successful save of the 'open' state
    mockSend.mockResolvedValueOnce({});

    const newState = await cb.recordFailure('timeout');
    expect(newState.state).toBe('open');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining({
            value: expect.objectContaining({ state: 'open' }),
          }),
        }),
      })
    );
  });

  it('should block autonomous requests when open and in cooldown', async () => {
    mockSend.mockResolvedValue({
      Item: {
        value: {
          state: 'open',
          lastStateChange: Date.now(),
          failures: Array(5).fill({ timestamp: Date.now(), type: 'error' }),
          version: 2,
        },
      },
    });

    const result = await cb.canProceed('autonomous');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Cooldown active');
  });

  it('should allow emergency bypass with rate limiting even when open', async () => {
    // 1. Load state (open)
    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'open',
          lastStateChange: Date.now() - 1000,
          emergencyDeployCount: 0,
          emergencyDeployWindowStart: Date.now(),
          version: 2,
        },
      },
    });
    // 2. Save incremented rate limit
    mockSend.mockResolvedValueOnce({});

    const result = await cb.canProceed('emergency');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('EMERGENCY_BYPASS_WITH_RATE_LIMIT');
  });

  it('should transition to half-open after cooldown', async () => {
    // 1. Load state (open, but past cooldown)
    mockSend.mockResolvedValueOnce({
      Item: {
        value: {
          state: 'open',
          lastStateChange: Date.now() - 600000, // 10 mins ago (default cooldown is 5 mins)
          failures: Array(5).fill({ timestamp: Date.now(), type: 'error' }),
          version: 2,
        },
      },
    });
    // 2. Save 'half_open' state
    mockSend.mockResolvedValueOnce({});

    const result = await cb.canProceed('autonomous');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('half_open');
  });
});
