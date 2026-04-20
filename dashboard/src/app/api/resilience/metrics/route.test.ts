import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock the core dependencies as a class for the constructor
vi.mock('@claw/core/lib/memory', () => {
  return {
    DynamoMemory: class {
      listByPrefix = vi.fn().mockResolvedValue([
        { timestamp: Date.now() - 3600000, outcome: 'failure' },
        { timestamp: Date.now() - 1800000, outcome: 'success' },
      ]);
    },
  };
});

vi.mock('@claw/core/lib/safety/circuit-breaker', () => {
  return {
    getCircuitBreaker: vi.fn().mockReturnValue({
      getState: vi.fn().mockResolvedValue({
        state: 'closed',
        lastFailureTime: 123456789,
        failures: [],
        emergencyDeployCount: 0,
      }),
    }),
  };
});

describe('Resilience Metrics API', () => {
  it('should return aggregated resilience metrics', async () => {
    const response = await GET(new Request('http://localhost/api/resilience/metrics') as unknown as NextRequest);
    const data = await response.json();

    if (data.error) {
      expect(data).toEqual({ healthScore: 'should not be error' });
    }

    expect(data).toHaveProperty('healthScore');
    expect(data).toHaveProperty('circuitBreaker');
    expect(data.circuitBreaker.state).toBe('closed');
  });
});
