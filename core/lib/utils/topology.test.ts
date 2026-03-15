import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverSystemTopology } from './topology';
import { BACKBONE_REGISTRY } from '../backbone';

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

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    WebhookApi: { url: 'https://api.test' },
    AgentBus: { name: 'test-bus' },
    Deployer: { name: 'test-deployer' },
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
    TraceTable: { name: 'test-traces' },
    StagingBucket: { name: 'test-staging' },
    KnowledgeBucket: { name: 'test-knowledge' },
    Notifier: { name: 'test-notifier' },
    RealtimeBus: { name: 'test-bridge' },
    Dashboard: { url: 'https://dashboard.test' },
    SuperClaw: { name: 'test-main' },
    Coder: { name: 'test-coder' },
    StrategicPlanner: { name: 'test-planner' },
    ReflectorAgent: { name: 'test-reflector' },
    QaAgent: { name: 'test-qa' },
  }
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

    expect(nodeIds).toContain('webhookapi');
    expect(nodeIds).toContain('agentbus');
    expect(nodeIds).toContain('deployer');
    expect(nodeIds).toContain('dashboard');
    expect(nodeIds).toContain('memorytable');
    expect(nodeIds).toContain('realtimebus');
    expect(nodeIds).toContain('telegram');
    expect(nodeIds).toContain('scheduler');
    expect(nodeIds).toContain('heartbeat');
  });

  it('should always include backbone agents even if DDB fails', async () => {
    const topology = await discoverSystemTopology();
    const nodeIds = topology.nodes.map((n) => n.id);

    Object.keys(BACKBONE_REGISTRY).forEach((id) => {
      expect(nodeIds).toContain(id.toLowerCase());
    });
  });

  it('should correctly link API Gateway to AgentBus', async () => {
    const topology = await discoverSystemTopology();
    const apiToBus = topology.edges.find((e) => e.source === 'webhookapi' && e.target === 'agentbus');

    expect(apiToBus).toBeDefined();
    expect(apiToBus?.label).toBe('SIGNAL');
  });

  it('link agents to AgentBus for orchestration', async () => {
    const topology = await discoverSystemTopology();
    const coderToBus = topology.edges.find(
      (e) => e.source === 'coder' && e.target === 'agentbus'
    );

    expect(coderToBus).toBeDefined();
    expect(coderToBus?.label).toBe('ORCHESTRATE');
  });

  it('should handle proactive scheduler and heartbeat connections', async () => {
    const topology = await discoverSystemTopology();

    expect(
      topology.edges.find((e) => e.source === 'scheduler' && e.target === 'heartbeat')
    ).toBeDefined();
    expect(
      topology.edges.find((e) => e.source === 'heartbeat' && e.target === 'agentbus')
    ).toBeDefined();
  });

  it('should handle tool-based resource mapping for the Coder Agent', async () => {
    const topology = await discoverSystemTopology();

    // Coder -> Deployer (via triggerDeployment)
    const buildEdge = topology.edges.find((e) => e.source === 'coder' && e.target === 'deployer');
    expect(buildEdge).toBeDefined();
    expect(buildEdge?.label).toBe('USE');
  });

  it('should be resilient to DynamoDB errors', async () => {
    const { ConfigManager } = await import('../registry/config');
    vi.mocked(ConfigManager.resolveTableName).mockRejectedValueOnce(new Error('DDB Down'));

    const topology = await discoverSystemTopology();

    // Should still have backbone agents
    expect(topology.nodes.length).toBeGreaterThanOrEqual(Object.keys(BACKBONE_REGISTRY).length);
  });
});
