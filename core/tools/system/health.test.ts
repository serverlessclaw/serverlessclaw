import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const codebuildMock = mockClient(CodeBuildClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
    Deployer: { name: 'test-deployer' },
  },
}));

// Mock health lib
vi.mock('../../lib/health', () => ({
  checkCognitiveHealth: vi.fn(),
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock constants
vi.mock('../../lib/constants', () => ({
  MEMORY_KEYS: {
    HEALTH_PREFIX: 'HEALTH#',
  },
  RETENTION: {
    HEALTH_DAYS: 30,
  },
  TIME: {
    MS_PER_DAY: 86400000,
    MS_PER_HOUR: 3600000,
  },
}));

// Mock BaseMemoryProvider
const createMockBase = () => ({
  putItem: vi.fn().mockResolvedValue(undefined),
  queryItems: vi.fn().mockResolvedValue([]),
  queryItemsPaginated: vi.fn().mockResolvedValue({ items: [] }),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  updateItem: vi.fn().mockResolvedValue(undefined),
  scanByPrefix: vi.fn().mockResolvedValue([]),
  getHistory: vi.fn().mockResolvedValue([]),
  clearHistory: vi.fn().mockResolvedValue(undefined),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  listConversations: vi.fn().mockResolvedValue([]),
});

// Mock DynamoMemory to return our mock base
vi.mock('../../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, createMockBase());
  }),
}));

import { checkHealth, runCognitiveHealthCheck } from './health';
import { checkCognitiveHealth } from '../../lib/health';

// Mock exec
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, cb) => cb(null, { stdout: 'ok', stderr: '' })),
}));

describe('system tools', () => {
  beforeEach(() => {
    codebuildMock.reset();
    ddbMock.reset();
    vi.clearAllMocks();
  });

  describe('checkHealth', () => {
    it('should return JSON when verbose=true', async () => {
      vi.mocked(checkCognitiveHealth).mockResolvedValue({
        ok: true,
        summary: 'All systems green',
        timestamp: Date.now(),
        results: {
          bus: { ok: true, latencyMs: 10 },
          tools: { ok: true, latencyMs: 20 },
          providers: { ok: true, latencyMs: 30 },
        },
      });

      const result = await checkHealth.execute({ verbose: true });
      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.summary).toBe('All systems green');
    });

    it('should return FAILED when checkCognitiveHealth says false and verbose=false', async () => {
      vi.mocked(checkCognitiveHealth).mockResolvedValue({
        ok: false,
        summary: 'System unstable',
        timestamp: Date.now(),
        results: {
          bus: { ok: false, latencyMs: 10, error: 'Connection timeout' },
          tools: { ok: true, latencyMs: 20 },
          providers: { ok: true, latencyMs: 30 },
        },
      });

      const result = await checkHealth.execute({ verbose: false });
      expect(result).toContain('FAILED');
      expect(result).toContain('System unstable');
    });
  });

  describe('runCognitiveHealthCheck', () => {
    it('should return success with default snapshot', async () => {
      const result = await runCognitiveHealthCheck.execute({});
      // With empty metrics, the score should be 100 (default)
      expect(result).toContain('100/100');
      expect(result).toContain('optimal');
    });

    it('should return success with specific agent IDs', async () => {
      const result = await runCognitiveHealthCheck.execute({
        agentIds: ['agent-1', 'agent-2'],
      });
      expect(result).toContain('100/100');
    });

    it('should return verbose JSON when verbose=true', async () => {
      const result = await runCognitiveHealthCheck.execute({ verbose: true });
      const parsed = JSON.parse(result);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.overallScore).toBeDefined();
      expect(parsed.reasoning).toBeDefined();
      expect(parsed.memory).toBeDefined();
      expect(parsed.anomalies).toBeDefined();
      expect(parsed.agentMetrics).toBeDefined();
    });
  });
});
