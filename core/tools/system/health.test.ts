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
vi.mock('../../lib/lifecycle/health', () => ({
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

// Mock ConfigManager for debugAgent - using hoisted mock factory
const { mockSaveRawConfig } = vi.hoisted(() => ({
  mockSaveRawConfig: vi.fn(),
}));

vi.mock('../../lib/registry/config', async () => {
  return {
    ConfigManager: {
      saveRawConfig: mockSaveRawConfig,
    },
  };
});

// Mock constants
vi.mock('../../lib/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    TIME: {
      MS_PER_SECOND: 1000,
      MS_PER_MINUTE: 60000,
      MS_PER_HOUR: 3600000,
      MS_PER_DAY: 86400000,
    },
  };
});

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

import { checkHealth, runCognitiveHealthCheck, debugAgent } from './health';
import { checkCognitiveHealth } from '../../lib/lifecycle/health';

// Mock exec
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, cb) => cb(null, { stdout: 'ok', stderr: '' })),
}));

describe('system tools', () => {
  beforeEach(() => {
    codebuildMock.reset();
    ddbMock.reset();
    vi.clearAllMocks();
    mockSaveRawConfig.mockReset();
    mockSaveRawConfig.mockResolvedValue(undefined);
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

    it('should return error message when checkCognitiveHealth throws', async () => {
      vi.mocked(checkCognitiveHealth).mockRejectedValue(new Error('Health service down'));

      const result = await checkHealth.execute({});
      expect(result).toContain('Error executing health check');
      expect(result).toContain('Health service down');
    });
  });

  describe('runCognitiveHealthCheck', () => {
    it('should return success with default snapshot', async () => {
      const result = await runCognitiveHealthCheck.execute({});
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

    it('should return warning when score is between 60 and 79', async () => {
      const mockSnapshot = {
        overallScore: 70,
        anomalies: [{ severity: 'medium', message: 'test' }],
        timestamp: Date.now(),
        reasoning: {},
        memory: {},
        agentMetrics: [],
      };
      const { CognitiveHealthMonitor } = await import('../../lib/metrics/cognitive-metrics');
      vi.mocked(CognitiveHealthMonitor).prototype.takeSnapshot = vi
        .fn()
        .mockResolvedValue(mockSnapshot);
      vi.mocked(CognitiveHealthMonitor).prototype.start = vi.fn();
      vi.mocked(CognitiveHealthMonitor).prototype.stop = vi.fn();

      const result = await runCognitiveHealthCheck.execute({});
      expect(result).toContain('70/100');
      expect(result).toContain('Minor degradation');
    });

    it('should return critical when score is below 60', async () => {
      const mockSnapshot = {
        overallScore: 40,
        anomalies: [
          { severity: 'critical', message: 'critical issue' },
          { severity: 'high', message: 'high issue' },
          { severity: 'low', message: 'low issue' },
        ],
        timestamp: Date.now(),
        reasoning: {},
        memory: {},
        agentMetrics: [],
      };
      const { CognitiveHealthMonitor } = await import('../../lib/metrics/cognitive-metrics');
      vi.mocked(CognitiveHealthMonitor).prototype.takeSnapshot = vi
        .fn()
        .mockResolvedValue(mockSnapshot);
      vi.mocked(CognitiveHealthMonitor).prototype.start = vi.fn();
      vi.mocked(CognitiveHealthMonitor).prototype.stop = vi.fn();

      const result = await runCognitiveHealthCheck.execute({});
      expect(result).toContain('40/100');
      expect(result).toContain('Anomalies: 3 (2 critical/high)');
      expect(result).toContain('Significant cognitive degradation');
    });

    it('should return error message when cognitive health check throws', async () => {
      const { CognitiveHealthMonitor } = await import('../../lib/metrics/cognitive-metrics');
      vi.mocked(CognitiveHealthMonitor).prototype.takeSnapshot = vi
        .fn()
        .mockRejectedValue(new Error('Connection failed'));
      vi.mocked(CognitiveHealthMonitor).prototype.start = vi.fn();
      vi.mocked(CognitiveHealthMonitor).prototype.stop = vi.fn();

      const result = await runCognitiveHealthCheck.execute({});
      expect(result).toContain('Error executing cognitive health check');
      expect(result).toContain('Connection failed');
    });
  });

  describe('debugAgent', () => {
    it('should activate debug mode for an agent', async () => {
      mockSaveRawConfig.mockResolvedValue(undefined);

      const result = await debugAgent.execute({ agentId: 'test-agent', level: 'debug' });
      expect(result).toContain('DEBUG_MODE_ACTIVATED');
      expect(result).toContain('test-agent');
      expect(result).toContain('DEBUG');
      expect(mockSaveRawConfig).toHaveBeenCalledWith('debug_test-agent', 'debug');
    });

    it('should return error message when config save fails', async () => {
      mockSaveRawConfig.mockRejectedValue(new Error('Config service unavailable'));

      const result = await debugAgent.execute({ agentId: 'test-agent', level: 'verbose' });
      expect(result).toContain('Failed to activate debug mode');
      expect(result).toContain('Config service unavailable');
    });
  });
});
