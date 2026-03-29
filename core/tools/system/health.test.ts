import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { checkHealth } from './health';
import { checkCognitiveHealth } from '../../lib/health';

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
});
