import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the core memory module
const mockListByPrefix = vi.fn();
vi.mock('@claw/core/lib/memory', () => ({
  DynamoMemory: class {
    listByPrefix = mockListByPrefix;
  },
}));

describe('/api/cognitive-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return cognitive health data when successful', async () => {
    const mockItems = [
      {
        userId: 'HEALTH#agent1',
        score: 85,
        taskCompletionRate: 0.95,
        reasoningCoherence: 8.5,
        errorRate: 0.02,
        memoryFragmentation: 0.15,
        anomalies: [{ type: 'PERFORMANCE', severity: 'MEDIUM', message: 'High latency detected' }],
      },
      {
        userId: 'HEALTH#agent2',
        score: 92,
        taskCompletionRate: 0.98,
        reasoningCoherence: 9.0,
        errorRate: 0.01,
        memoryFragmentation: 0.1,
        anomalies: [],
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents).toHaveLength(2);
    expect(data.agents[0]).toEqual({
      agentId: 'agent1',
      score: 85,
      taskCompletionRate: 0.95,
      reasoningCoherence: 8.5,
      errorRate: 0.02,
      memoryFragmentation: 0.15,
      anomalies: [{ type: 'PERFORMANCE', severity: 'MEDIUM', message: 'High latency detected' }],
    });
    expect(data.agents[1]).toEqual({
      agentId: 'agent2',
      score: 92,
      taskCompletionRate: 0.98,
      reasoningCoherence: 9.0,
      errorRate: 0.01,
      memoryFragmentation: 0.1,
      anomalies: [],
    });
  });

  it('should filter out items without required score field', async () => {
    const mockItems = [
      {
        userId: 'HEALTH#agent1',
        // Missing score field -- should be filtered out
      },
      {
        userId: 'HEALTH#agent2',
        score: 70,
        taskCompletionRate: 0.8,
        reasoningCoherence: 7.0,
        errorRate: 0.1,
        memoryFragmentation: 0.2,
        anomalies: [],
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].agentId).toBe('agent2');
    expect(data.agents[0].score).toBe(70);
  });

  it('should return message when no health data exists', async () => {
    mockListByPrefix.mockResolvedValue([]);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents).toEqual([]);
    expect(data.message).toBe('No health data recorded');
  });

  it('should return 500 on error', async () => {
    mockListByPrefix.mockRejectedValue(new Error('DynamoDB error'));

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.agents).toEqual([]);
    expect(data.error).toBe('Failed to fetch health data');
  });

  it('should strip HEALTH# prefix from agentId', async () => {
    const mockItems = [
      {
        userId: 'HEALTH#my-custom-agent-id',
        score: 75,
        taskCompletionRate: 0.85,
        reasoningCoherence: 7.5,
        errorRate: 0.1,
        memoryFragmentation: 0.25,
        anomalies: [],
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(data.agents[0].agentId).toBe('my-custom-agent-id');
  });

  it('should preserve anomalies array', async () => {
    const mockItems = [
      {
        userId: 'HEALTH#agent1',
        score: 60,
        taskCompletionRate: 0.7,
        reasoningCoherence: 6.0,
        errorRate: 0.15,
        memoryFragmentation: 0.3,
        anomalies: [
          { type: 'MEMORY', severity: 'HIGH', message: 'Memory leak detected' },
          { type: 'PERFORMANCE', severity: 'CRITICAL', message: 'System overload' },
        ],
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(data.agents[0].anomalies).toHaveLength(2);
    expect(data.agents[0].anomalies[0]).toEqual({
      type: 'MEMORY',
      severity: 'HIGH',
      message: 'Memory leak detected',
    });
    expect(data.agents[0].anomalies[1]).toEqual({
      type: 'PERFORMANCE',
      severity: 'CRITICAL',
      message: 'System overload',
    });
  });

  it('should handle empty anomalies array', async () => {
    const mockItems = [
      {
        userId: 'HEALTH#agent1',
        score: 95,
        taskCompletionRate: 0.99,
        reasoningCoherence: 9.5,
        errorRate: 0.005,
        memoryFragmentation: 0.05,
        anomalies: [],
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(data.agents[0].anomalies).toEqual([]);
  });

  it('should have force-dynamic export', async () => {
    const routeModule = await import('./route');
    expect(routeModule.dynamic).toBe('force-dynamic');
  });
});
