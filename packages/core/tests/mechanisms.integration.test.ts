import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler as recoveryHandler } from '../handlers/recovery';
import { SelfVerifier } from '../lib/lifecycle/self-verify';

// Mock dependencies
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('sst', () => ({
  Resource: {
    WebhookApi: { url: 'https://api.test' },
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
    Deployer: { name: 'test-deployer' },
  },
}));

vi.mock('@aws-sdk/client-codebuild', () => ({
  CodeBuildClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  StartBuildCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  ListEventBusesCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: mockSend,
    }),
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
  QueryCommand: class {
    constructor(public input: unknown) {}
  },
  ScanCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteCommand: class {
    constructor(public input: unknown) {}
  },
}));

describe('Integrated Mechanism Verification', () => {
  let verifier: SelfVerifier;

  beforeEach(() => {
    vi.clearAllMocks();
    verifier = new SelfVerifier();
    // Default healthy mock
    mockFetch.mockResolvedValue({ ok: true });
  });

  describe('Resilience Integration', () => {
    it('should reflect recovery activity in verification status after health failure', async () => {
      // 1. Simulate failure
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      // Mock DDB calls for recovery handler
      mockSend.mockResolvedValue({ Item: { count: 1 } }); // Lock acquisition/Memory check

      // Run recovery handler (simulated hourly probe)
      await recoveryHandler();

      // 2. Mock DDB calls for verifier to reflect the new state
      mockSend.mockResolvedValueOnce({ Item: { deploy_limit: 5 } }); // verifyResilience config lookup
      mockSend.mockResolvedValueOnce({ Item: { count: 3, lastReset: '2026-03-15' } }); // verifyResilience stats lookup

      const status = await verifier.verifyResilience();

      expect(status.deployCountToday).toBe(3);
      // Resilience is still ok as it's below limit, but we've verified the path
    }, 15000);
  });

  describe('Evolution Integration', () => {
    it('should track gap lifecycle from discovery to verification', async () => {
      // simulate gap discovery
      mockSend.mockResolvedValueOnce({
        Items: [
          { id: 'GAP#1', status: 'OPEN' },
          { id: 'GAP#2', status: 'DONE' },
          { id: 'GAP#3', status: 'FAILED' },
        ],
      });

      const status = await verifier.verifyEvolution();
      expect(status.totalGaps).toBe(3);
      expect(status.activeGaps).toBe(1);
      expect(status.fixSuccessRate).toBe(50);
    });
  });

  describe('Awareness Integration', () => {
    it('should verify infrastructure discovery health', async () => {
      // Mock topology with 2 agents
      mockSend.mockResolvedValueOnce({
        Item: {
          nodes: [
            { id: 'agent-1', type: 'agent' },
            { id: 'agent-2', type: 'agent' },
          ],
          updatedAt: '2026-03-15T12:00:00Z',
        },
      });

      // Mock registry with 2 agents
      mockSend.mockResolvedValueOnce({
        Items: [{ id: 'AGENT#agent-1' }, { id: 'AGENT#agent-2' }],
      });

      const status = await verifier.verifyAwareness();
      expect(status.registryCoverage).toBe(100);
      expect(status.nodeCount).toBe(2);
    });
  });
});
