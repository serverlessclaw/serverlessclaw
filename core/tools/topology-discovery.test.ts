import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspectTopology } from './topology-discovery';
import { discoverSystemTopology } from '../lib/utils/topology';

vi.mock('../lib/utils/topology', () => ({
  discoverSystemTopology: vi.fn(),
}));

describe('inspectTopology tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a condensed JSON summary of the topology', async () => {
    const mockTopology = {
      nodes: [
        { id: 'main', label: 'SuperClaw', type: 'agent', tier: 'APP', isBackbone: true },
        { id: 'agentbus', label: 'AgentBus', type: 'bus', tier: 'COMM', isBackbone: true },
      ],
      edges: [
        { source: 'main', target: 'agentbus', label: 'ORCHESTRATE' },
      ],
    };

    vi.mocked(discoverSystemTopology).mockResolvedValue(mockTopology as any);

    const result = await inspectTopology.execute();
    const parsed = JSON.parse(result);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0].id).toBe('main');
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].from).toBe('main');
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(discoverSystemTopology).mockRejectedValue(new Error('Discovery Failed'));

    const result = await inspectTopology.execute();
    expect(result).toContain('FAILED_TO_DISCOVER_TOPOLOGY');
    expect(result).toContain('Discovery Failed');
  });
});
