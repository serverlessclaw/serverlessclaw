import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the core memory module
const mockListByPrefix = vi.fn();
vi.mock('@claw/core/lib/memory', () => ({
  DynamoMemory: class {
    listByPrefix = mockListByPrefix;
  },
}));

describe('/api/reputation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return reputation data when successful', async () => {
    const mockItems = [
      {
        userId: 'REPUTATION#agent1',
        tasksCompleted: 10,
        tasksFailed: 1,
        successRate: 0.9,
        avgLatencyMs: 500,
        lastActive: 1700000000000,
      },
      {
        userId: 'REPUTATION#agent2',
        tasksCompleted: 5,
        tasksFailed: 0,
        successRate: 1.0,
        avgLatencyMs: 300,
        lastActive: 1700000001000,
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reputation).toHaveLength(2);
    expect(data.reputation[0]).toEqual({
      agentId: 'agent1',
      tasksCompleted: 10,
      tasksFailed: 1,
      successRate: 0.9,
      avgLatencyMs: 500,
      lastActive: 1700000000000,
    });
    expect(data.reputation[1]).toEqual({
      agentId: 'agent2',
      tasksCompleted: 5,
      tasksFailed: 0,
      successRate: 1.0,
      avgLatencyMs: 300,
      lastActive: 1700000001000,
    });
  });

  it('should handle items with missing fields gracefully', async () => {
    const mockItems = [
      {
        userId: 'REPUTATION#agent1',
        // Missing tasksCompleted, tasksFailed, etc.
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reputation).toHaveLength(1);
    expect(data.reputation[0]).toEqual({
      agentId: 'agent1',
      tasksCompleted: 0,
      tasksFailed: 0,
      successRate: 0,
      avgLatencyMs: 0,
      lastActive: 0,
    });
  });

  it('should return empty array when no reputation data exists', async () => {
    mockListByPrefix.mockResolvedValue([]);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reputation).toEqual([]);
  });

  it('should return empty array on error', async () => {
    mockListByPrefix.mockRejectedValue(new Error('DynamoDB error'));

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reputation).toEqual([]);
  });

  it('should strip REPUTATION# prefix from agentId', async () => {
    const mockItems = [
      {
        userId: 'REPUTATION#my-custom-agent-id',
        tasksCompleted: 1,
        tasksFailed: 0,
        successRate: 1.0,
        avgLatencyMs: 100,
        lastActive: 1700000000000,
      },
    ];

    mockListByPrefix.mockResolvedValue(mockItems);

    const { GET } = await import('./route');
    const response = await GET();
    const data = await response.json();

    expect(data.reputation[0].agentId).toBe('my-custom-agent-id');
  });

  it('should have force-dynamic export', async () => {
    const routeModule = await import('./route');
    expect(routeModule.dynamic).toBe('force-dynamic');
  });
});
