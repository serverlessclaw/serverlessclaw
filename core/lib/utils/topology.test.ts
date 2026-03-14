import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverSystemTopology } from './topology';
import { BACKBONE_REGISTRY } from '../backbone';
import { AgentType } from '../types/agent';

// Mock ConfigManager
vi.mock('../registry/config', () => ({
  ConfigManager: {
    resolveTableName: vi.fn(),
  },
}));

// Mock DynamoDB
vi.mock('@aws-sdk/client-dynamodb', () => {
  const mockSend = vi.fn().mockResolvedValue({ Items: [] });
  const MockClient = vi.fn(function () {
    return { send: mockSend };
  });
  return {
    DynamoDBClient: MockClient,
    ScanCommand: vi.fn(),
  };
});

// Mock lib-dynamodb
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation((client) => client),
  },
  PutCommand: vi.fn(),
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

// Mock agent prompts to break dependency chains (preventing DynamoDB imports)
vi.mock('../agents/superclaw', () => ({ SUPERCLAW_SYSTEM_PROMPT: 'test' }));
vi.mock('../agents/coder', () => ({ CODER_SYSTEM_PROMPT: 'test' }));
vi.mock('../agents/strategic-planner', () => ({ PLANNER_SYSTEM_PROMPT: 'test' }));
vi.mock('../agents/cognition-reflector', () => ({ REFLECTOR_SYSTEM_PROMPT: 'test' }));
vi.mock('../agents/qa', () => ({ QA_SYSTEM_PROMPT: 'test' }));

describe('discoverSystemTopology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should always include baseline infrastructure nodes', async () => {
    const topology = await discoverSystemTopology();
    const nodeIds = topology.nodes.map((n) => n.id);

    expect(nodeIds).toContain('api');
    expect(nodeIds).toContain('bus');
    expect(nodeIds).toContain('codebuild');
    expect(nodeIds).toContain('dashboard');
    expect(nodeIds).toContain('memory');
    expect(nodeIds).toContain('bridge');
    expect(nodeIds).toContain('telegram');
  });

  it('should always include backbone agents even if DDB fails', async () => {
    const topology = await discoverSystemTopology();
    const nodeIds = topology.nodes.map((n) => n.id);

    Object.keys(BACKBONE_REGISTRY).forEach((id) => {
      expect(nodeIds).toContain(id);
    });
  });

  it('should correctly link API Gateway to SuperClaw and Config', async () => {
    const topology = await discoverSystemTopology();
    const mainEdge = topology.edges.find((e) => e.source === 'api' && e.target === AgentType.MAIN);
    const configEdge = topology.edges.find((e) => e.source === 'api' && e.target === 'config');

    expect(mainEdge).toBeDefined();
    expect(mainEdge?.label).toBe('INBOUND');
    expect(configEdge).toBeDefined();
    expect(configEdge?.label).toBe('MANAGE');
  });

  it('should link agents to AgentBus for orchestration', async () => {
    const topology = await discoverSystemTopology();
    const coderToBus = topology.edges.find(
      (e) => e.source === AgentType.CODER && e.target === 'bus'
    );

    expect(coderToBus).toBeDefined();
    expect(coderToBus?.label).toBe('ORCHESTRATE');
  });

  it('should handle telegram inbound and outbound connections', async () => {
    const topology = await discoverSystemTopology();

    // Telegram -> API (Inbound)
    expect(topology.edges.find((e) => e.source === 'telegram' && e.target === 'api')).toBeDefined();

    // Notifier -> Telegram (Outbound)
    expect(
      topology.edges.find((e) => e.source === 'notifier' && e.target === 'telegram')
    ).toBeDefined();
  });

  it('should handle realtime bridge connections', async () => {
    const topology = await discoverSystemTopology();

    // Bus -> Bridge -> Dashboard
    expect(topology.edges.find((e) => e.source === 'bus' && e.target === 'bridge')).toBeDefined();
    expect(
      topology.edges.find((e) => e.source === 'bridge' && e.target === 'dashboard')
    ).toBeDefined();

    // SuperClaw -> Dashboard (Realtime)
    expect(
      topology.edges.find((e) => e.source === AgentType.MAIN && e.target === 'dashboard')
    ).toBeDefined();
  });

  it('should handle knowledge bucket connections', async () => {
    const topology = await discoverSystemTopology();

    expect(topology.nodes.map((n) => n.id)).toContain('knowledge');
    expect(
      topology.edges.find((e) => e.source === AgentType.MAIN && e.target === 'knowledge')
    ).toBeDefined();
    expect(
      topology.edges.find((e) => e.source === AgentType.CODER && e.target === 'knowledge')
    ).toBeDefined();
    expect(
      topology.edges.find(
        (e) => e.source === AgentType.STRATEGIC_PLANNER && e.target === 'knowledge'
      )
    ).toBeDefined();
  });

  it('should handle tool-based resource mapping for the Coder Agent', async () => {
    const topology = await discoverSystemTopology();

    // Coder -> BuildEngine (via triggerDeployment)
    const buildEdge = topology.edges.find(
      (e) => e.source === AgentType.CODER && e.target === 'codebuild'
    );
    expect(buildEdge).toBeDefined();

    // Coder -> Storage (via aws-s3_*)
    const storageEdge = topology.edges.find(
      (e) => e.source === AgentType.CODER && e.target === 'storage'
    );
    expect(storageEdge).toBeDefined();
  });

  it('should be resilient to DynamoDB errors', async () => {
    const { ConfigManager } = await import('../registry/config');
    vi.mocked(ConfigManager.resolveTableName).mockRejectedValueOnce(new Error('DDB Down'));

    const topology = await discoverSystemTopology();

    // Should still have backbone agents
    expect(topology.nodes.length).toBeGreaterThanOrEqual(Object.keys(BACKBONE_REGISTRY).length);
  });
});
