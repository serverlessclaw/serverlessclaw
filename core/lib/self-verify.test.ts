import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelfVerifier } from './self-verify';
import { GapStatus } from './types/index';

// Mock SST
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
  },
}));

const { mockSend, mockRunDeepHealthCheck } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockRunDeepHealthCheck: vi.fn(),
}));

vi.mock('./health', () => ({
  runDeepHealthCheck: mockRunDeepHealthCheck,
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
  ScanCommand: class {
    constructor(public input: unknown) {}
  },
  QueryCommand: class {
    constructor(public input: unknown) {}
  },
}));

describe('SelfVerifier', () => {
  let verifier: SelfVerifier;

  beforeEach(() => {
    vi.clearAllMocks();
    verifier = new SelfVerifier();
  });

  describe('verifyEvolution', () => {
    it('should calculate gap statistics correctly', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { id: 'GAP#1', status: GapStatus.OPEN },
          { id: 'GAP#2', status: GapStatus.PROGRESS },
          { id: 'GAP#3', status: GapStatus.DONE },
          { id: 'GAP#4', status: GapStatus.DONE },
          { id: 'GAP#5', status: GapStatus.FAILED },
          { id: 'GAP#6', status: GapStatus.FAILED },
        ],
      });

      const result = await verifier.verifyEvolution();

      expect(result.totalGaps).toBe(6);
      expect(result.activeGaps).toBe(2);
      expect(result.fixSuccessRate).toBe(50);
    });

    it('should handle zero gaps gracefully', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await verifier.verifyEvolution();
      expect(result.totalGaps).toBe(0);
      expect(result.fixSuccessRate).toBe(100);
    });
  });

  describe('verifyResilience', () => {
    it('should detect active circuit breaker using config limit', async () => {
      // 1. Mock Config (limit: 3)
      mockSend.mockResolvedValueOnce({
        Item: { deploy_limit: 3 },
      });
      // 2. Mock Stats (count: 3)
      mockSend.mockResolvedValueOnce({
        Item: { count: 3 },
      });
      // 3. Mock Deep Health
      mockRunDeepHealthCheck.mockResolvedValueOnce({ ok: true });

      const result = await verifier.verifyResilience();

      expect(result.deployCountToday).toBe(3);
      expect(result.circuitBreakerActive).toBe(true);
      expect(result.apiHealthy).toBe(true);
    });

    it('should respect default limit if config is missing', async () => {
      // 1. Mock Config (empty)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // 2. Mock Stats (count: 2)
      mockSend.mockResolvedValueOnce({
        Item: { count: 2 },
      });
      // 3. Mock Deep Health (failed)
      mockRunDeepHealthCheck.mockResolvedValueOnce({ ok: false });

      const result = await verifier.verifyResilience();

      expect(result.deployCountToday).toBe(2);
      expect(result.circuitBreakerActive).toBe(false); // default 5
      expect(result.apiHealthy).toBe(false);
    });
  });

  describe('verifyAwareness', () => {
    it('should calculate registry coverage correctly', async () => {
      // 1. Mock topology
      mockSend.mockResolvedValueOnce({
        Item: {
          nodes: [
            { id: 'sc', type: 'agent' },
            { id: 'ca', type: 'agent' },
            { id: 'db', type: 'infra' },
          ],
          updatedAt: '2026-03-15T10:00:00Z',
        },
      });

      // 2. Mock registry
      mockSend.mockResolvedValueOnce({
        Items: [{ id: 'AGENT#sc' }, { id: 'AGENT#ca' }, { id: 'AGENT#wa' }],
      });

      const result = await verifier.verifyAwareness();

      expect(result.nodeCount).toBe(3);
      expect(result.registryCoverage).toBeCloseTo(66.66, 1);
      expect(result.lastScanTimestamp).toBe('2026-03-15T10:00:00Z');
    });
  });
});
