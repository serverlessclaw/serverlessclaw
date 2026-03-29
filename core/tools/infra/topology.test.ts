import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspectTopology, discoverPeers, registerPeer } from './topology';
import { discoverSystemTopology } from '../../lib/utils/topology';
import { Topology } from '../../lib/types/system';

vi.mock('../../lib/utils/topology', () => ({
  discoverSystemTopology: vi.fn(),
}));

vi.mock('../../lib/registry', () => ({
  AgentRegistry: {
    getAllConfigs: vi.fn().mockResolvedValue({
      coder: {
        id: 'coder',
        name: 'Coder Agent',
        systemPrompt: '',
        enabled: true,
        isBackbone: true,
        category: 'system',
        tools: ['fileWrite', 'triggerDeployment'],
      },
      planner: {
        id: 'planner',
        name: 'Strategic Planner',
        systemPrompt: '',
        enabled: true,
        isBackbone: true,
        category: 'system',
        tools: ['dispatchTask', 'recallKnowledge'],
      },
      'custom-agent': {
        id: 'custom-agent',
        name: 'Custom',
        systemPrompt: '',
        enabled: true,
        category: 'social',
        tools: ['sendMessage'],
      },
      disabled: {
        id: 'disabled',
        name: 'Disabled',
        systemPrompt: '',
        enabled: false,
      },
    }),
  },
}));

const mockGetRawConfig = vi.fn();
const mockSaveRawConfig = vi.fn();

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: (...args: unknown[]) => mockGetRawConfig(...args),
    saveRawConfig: (...args: unknown[]) => mockSaveRawConfig(...args),
  },
}));

describe('inspectTopology tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a condensed JSON summary of the topology', async () => {
    const mockTopology = {
      nodes: [
        { id: 'superclaw', label: 'SuperClaw', type: 'agent', tier: 'APP', isBackbone: true },
        { id: 'agentbus', label: 'AgentBus', type: 'bus', tier: 'COMM', isBackbone: true },
      ],
      edges: [{ source: 'superclaw', target: 'agentbus', label: 'ORCHESTRATE' }],
    };

    vi.mocked(discoverSystemTopology).mockResolvedValue(mockTopology as unknown as Topology);

    const result = await inspectTopology.execute();
    const parsed = JSON.parse(result);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0].id).toBe('superclaw');
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].from).toBe('superclaw');
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(discoverSystemTopology).mockRejectedValue(new Error('Discovery Failed'));

    const result = await inspectTopology.execute();
    expect(result).toContain('FAILED_TO_DISCOVER_TOPOLOGY');
    expect(result).toContain('Discovery Failed');
  });
});

describe('discoverPeers tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawConfig.mockResolvedValue([]);
  });

  it('should list all enabled agents by default', async () => {
    const result = await discoverPeers.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.peerCount).toBe(3); // 3 enabled agents
    expect(parsed.topologyType).toBe('mesh');
    expect(parsed.peers.map((p: { id: string }) => p.id)).toContain('coder');
    expect(parsed.peers.map((p: { id: string }) => p.id)).toContain('planner');
    expect(parsed.peers.map((p: { id: string }) => p.id)).toContain('custom-agent');
    // disabled agent should NOT be included
    expect(parsed.peers.map((p: { id: string }) => p.id)).not.toContain('disabled');
  });

  it('should filter by category', async () => {
    const result = await discoverPeers.execute({ category: 'system' });
    const parsed = JSON.parse(result);

    expect(parsed.peerCount).toBe(2);
    expect(parsed.peers.every((p: { category: string }) => p.category === 'system')).toBe(true);
  });

  it('should filter by capability', async () => {
    const result = await discoverPeers.execute({ capability: 'deployment' });
    const parsed = JSON.parse(result);

    expect(parsed.peerCount).toBe(1);
    expect(parsed.peers[0].id).toBe('coder');
  });

  it('should respect topologyType option', async () => {
    const result = await discoverPeers.execute({ topologyType: 'hierarchy' });
    const parsed = JSON.parse(result);

    expect(parsed.topologyType).toBe('hierarchy');
  });

  it('should include existing connections from topology', async () => {
    mockGetRawConfig.mockResolvedValue([
      { sourceAgentId: 'coder', targetAgentId: 'planner', topologyType: 'mesh' },
    ]);

    const result = await discoverPeers.execute({});
    const parsed = JSON.parse(result);

    const coderPeer = parsed.peers.find((p: { id: string }) => p.id === 'coder');
    expect(coderPeer.connections).toHaveLength(1);
  });
});

describe('registerPeer tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawConfig.mockResolvedValue([]);
    mockSaveRawConfig.mockResolvedValue(undefined);
  });

  it('should register a new peer connection', async () => {
    const result = await registerPeer.execute({
      sourceAgentId: 'coder',
      targetAgentId: 'planner',
      topologyType: 'mesh',
    });

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('registered');
    expect(parsed.connection.sourceAgentId).toBe('coder');
    expect(parsed.connection.targetAgentId).toBe('planner');
    expect(parsed.totalConnections).toBe(1);

    expect(mockSaveRawConfig).toHaveBeenCalledWith('swarm_topology', [
      expect.objectContaining({
        sourceAgentId: 'coder',
        targetAgentId: 'planner',
        topologyType: 'mesh',
      }),
    ]);
  });

  it('should prevent duplicate connections', async () => {
    mockGetRawConfig.mockResolvedValue([
      { sourceAgentId: 'coder', targetAgentId: 'planner', topologyType: 'mesh' },
    ]);

    const result = await registerPeer.execute({
      sourceAgentId: 'coder',
      targetAgentId: 'planner',
      topologyType: 'mesh',
    });

    expect(result).toContain('Connection already exists');
    expect(mockSaveRawConfig).not.toHaveBeenCalled();
  });

  it('should include custom label when provided', async () => {
    await registerPeer.execute({
      sourceAgentId: 'coder',
      targetAgentId: 'qa',
      topologyType: 'hierarchy',
      label: 'delegates code review to',
    });

    expect(mockSaveRawConfig).toHaveBeenCalledWith(
      'swarm_topology',
      expect.arrayContaining([expect.objectContaining({ label: 'delegates code review to' })])
    );
  });

  it('should generate default label when not provided', async () => {
    await registerPeer.execute({
      sourceAgentId: 'coder',
      targetAgentId: 'qa',
      topologyType: 'pipeline',
    });

    expect(mockSaveRawConfig).toHaveBeenCalledWith(
      'swarm_topology',
      expect.arrayContaining([expect.objectContaining({ label: 'coder connects to qa' })])
    );
  });
});
