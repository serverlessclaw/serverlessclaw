import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkReputation } from './reputation';
import { getReputation } from '../../lib/memory/reputation-operations';

vi.mock('../../lib/memory/reputation-operations', () => ({
  getReputation: vi.fn(),
}));

describe('Reputation Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully format and return reputation report', async () => {
    const mockReputation = {
      score: 0.85,
      successRate: 0.9,
      avgLatencyMs: 120.5,
      tasksCompleted: 10,
      tasksFailed: 1,
      lastActive: Date.now() - 3600000,
      windowStart: Date.now() - 86400000,
    };
    (getReputation as any).mockResolvedValue(mockReputation);

    const result = await checkReputation.execute({ agentId: 'researcher' });

    expect(result).toContain('Reputation Report for Agent: researcher');
    expect(result).toContain('Composite Score: 85.0/100');
    expect(result).toContain('Success Rate:    90.0%');
    expect(result).toContain('Avg Latency:     121ms');
    expect(result).toContain('Tasks Completed: 10');
  });

  it('should return helpful message if no reputation data found', async () => {
    (getReputation as any).mockResolvedValue(null);

    const result = await checkReputation.execute({ agentId: 'unknown' });

    expect(result).toBe('No reputation data found for agent: unknown');
  });

  it('should handle errors gracefully during retrieval', async () => {
    (getReputation as any).mockRejectedValue(new Error('DynamoDB Error'));

    const result = await checkReputation.execute({ agentId: 'researcher' });

    expect(result).toContain('Failed to retrieve reputation for researcher');
    expect(result).toContain('DynamoDB Error');
  });
});
