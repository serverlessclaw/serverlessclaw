import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullTopology = vi.fn();
const mockDiscoverSystemTopology = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-table' },
  },
}));

vi.mock('@claw/core/lib/registry/index', () => ({
  AgentRegistry: {
    getFullTopology: mockGetFullTopology,
  },
}));

vi.mock('@claw/core/lib/utils/topology', () => ({
  discoverSystemTopology: mockDiscoverSystemTopology,
}));

describe('Infrastructure API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stored topology when available', async () => {
    const storedTopology = {
      nodes: [{ id: 'superclaw', type: 'agent', label: 'SuperClaw' }],
      edges: [{ source: 'superclaw', target: 'bus' }],
    };
    mockGetFullTopology.mockResolvedValue(storedTopology);

    const { GET } = await import('./route');
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual(storedTopology);
  });

  it('falls back to live topology when stored is empty', async () => {
    mockGetFullTopology.mockResolvedValue({ nodes: [], edges: [] });
    const liveTopology = {
      nodes: [{ id: 'live-agent', type: 'agent', label: 'Live Agent' }],
      edges: [],
    };
    mockDiscoverSystemTopology.mockResolvedValue(liveTopology);

    const { GET } = await import('./route');
    const res = await GET();
    const data = await res.json();

    expect(data).toEqual(liveTopology);
  });

  it('returns empty topology when both stored and live are empty', async () => {
    mockGetFullTopology.mockResolvedValue({ nodes: [], edges: [] });
    mockDiscoverSystemTopology.mockResolvedValue({ nodes: [], edges: [] });

    const { GET } = await import('./route');
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.nodes).toBeDefined();
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it('returns 500 on critical error (discoverSystemTopology throws)', async () => {
    mockGetFullTopology.mockResolvedValue({ nodes: [], edges: [] });
    mockDiscoverSystemTopology.mockRejectedValue(new Error('SDK failure'));

    const { GET } = await import('./route');
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to fetch infrastructure');
  });
});
