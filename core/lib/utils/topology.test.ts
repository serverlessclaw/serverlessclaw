import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverSystemTopology } from './topology';
import { BACKBONE_REGISTRY } from '../backbone';
import { AgentType } from '../types/index';

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
    RealtimeBridge: { name: 'test-rt-bridge' },
    Realtime: { name: 'test-realtime' },
    Dashboard: { url: 'https://dashboard.test' },
    SuperClaw: { name: 'test-main' },
    Coder: { name: 'test-coder' },
    StrategicPlanner: { name: 'test-planner' },
    ReflectorAgent: { name: 'test-reflector' },
    QaAgent: { name: 'test-qa' },
    MCPGitServer: { name: 'test-mcp-git' },
  },
}));

// Mock S3
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn().mockResolvedValue({ Buckets: [] });
  },
  ListBucketsCommand: class {},
}));

// Mock Lambda
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = vi.fn().mockResolvedValue({ Functions: [] });
  },
  ListFunctionsCommand: class {},
}));

// Mock agent prompts to break dependency chains (preventing DynamoDB imports)

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
    // MemoryTable, ConfigTable, TraceTable all map to 'clawdb' via idOverride
    expect(nodeIds).toContain('clawdb');
    expect(nodeIds).toContain('mcpgitserver');
    expect(nodeIds).toContain('realtimebus');
    expect(nodeIds).toContain('telegram');
    expect(nodeIds).toContain('scheduler');
    expect(nodeIds).toContain('heartbeat');
  });

  it('should always include backbone agents even if DDB fails', async () => {
    const topology = await discoverSystemTopology();
    const nodeIds = topology.nodes.map((n) => n.id);

    Object.keys(BACKBONE_REGISTRY).forEach((id) => {
      const lowerId = id.toLowerCase();
      expect(nodeIds).toContain(lowerId);

      const node = topology.nodes.find((n) => n.id === lowerId);
      if (lowerId === 'superclaw') {
        expect(node?.tier).toBe('GATEWAY');
      }
    });
  });

  it('should place ClawCenter in the APP tier', async () => {
    const topology = await discoverSystemTopology();
    const dashboard = topology.nodes.find((n) => n.id === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard?.tier).toBe('APP');
  });

  it('should correctly link API Gateway to AgentBus', async () => {
    const topology = await discoverSystemTopology();
    const apiToBus = topology.edges.find(
      (e) => e.source === 'webhookapi' && e.target === 'agentbus'
    );

    expect(apiToBus).toBeDefined();
    expect(apiToBus?.label).toBe('SIGNAL');
  });

  it('link agents to AgentBus for orchestration', async () => {
    const topology = await discoverSystemTopology();
    const coderToBus = topology.edges.find((e) => e.source === 'coder' && e.target === 'agentbus');

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

  it('should handle real-time signaling flow', async () => {
    const topology = await discoverSystemTopology();

    // AgentBus -> Bridge
    expect(
      topology.edges.find((e) => e.source === 'agentbus' && e.target === 'realtimebridge')
    ).toBeDefined();
    // Bridge -> RealtimeBus
    expect(
      topology.edges.find((e) => e.source === 'realtimebridge' && e.target === 'realtimebus')
    ).toBeDefined();
    // RealtimeBus -> Dashboard
    expect(
      topology.edges.find((e) => e.source === 'realtimebus' && e.target === 'dashboard')
    ).toBeDefined();
  });

  it('should handle tool-based resource mapping for the Coder Agent', async () => {
    const topology = await discoverSystemTopology();

    // Coder -> Deployer (via triggerDeployment)
    const buildEdge = topology.edges.find((e) => e.source === 'coder' && e.target === 'deployer');
    expect(buildEdge).toBeDefined();
    expect(buildEdge?.label).toBe('USE');
  });

  it('should respect topologyOverride in agent configurations', async () => {
    // Inject an override into a backbone agent for testing
    BACKBONE_REGISTRY[AgentType.SUPERCLAW].topologyOverride = {
      label: 'Commander-in-Chief',
      icon: 'Shield',
      tier: 'INFRA',
    };

    const { nodes } = await discoverSystemTopology();
    const mainNode = nodes.find((n) => n.id === 'superclaw');

    expect(mainNode?.label).toBe('Commander-in-Chief');
    expect(mainNode?.icon).toBe('Shield');
    // For SuperClaw, reinforcement currently wins IF it's an existing node,
    // but the override wins if it's a new node. Let's make it consistent.
    expect(mainNode?.tier).toBe('INFRA');

    // Test override on another agent
    BACKBONE_REGISTRY['coder'].topologyOverride = {
      label: 'Lead Builder',
      tier: 'COMM',
    };
    const { nodes: nodes2 } = await discoverSystemTopology();
    const coderNode = nodes2.find((n) => n.id === 'coder');
    expect(coderNode?.label).toBe('Lead Builder');
    expect(coderNode?.tier).toBe('COMM');
  });

  it('should be resilient to DynamoDB errors', async () => {
    const { ConfigManager } = await import('../registry/config');
    vi.mocked(ConfigManager.resolveTableName).mockRejectedValueOnce(new Error('DDB Down'));

    const topology = await discoverSystemTopology();

    // Should still have backbone agents
    expect(topology.nodes.length).toBeGreaterThanOrEqual(Object.keys(BACKBONE_REGISTRY).length);
  });
});
