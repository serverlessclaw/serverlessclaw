import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TRIGGER_DEPLOYMENT, CHECK_HEALTH, TRIGGER_ROLLBACK } from './system';

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

// Mock deploy-stats
vi.mock('../lib/deploy-stats', () => ({
  getDeployCountToday: vi.fn(),
  incrementDeployCount: vi.fn(),
  rewardDeployLimit: vi.fn(),
}));

import { getDeployCountToday, incrementDeployCount, rewardDeployLimit } from '../lib/deploy-stats';

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

  describe('TRIGGER_DEPLOYMENT', () => {
    it('should trigger deployment if limit not reached', async () => {
      vi.mocked(getDeployCountToday).mockResolvedValue(5);
      ddbMock.on(GetCommand).resolves({ Item: { value: 10 } }); // limit
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-123' } });
      ddbMock.on(PutCommand).resolves({});

      const result = await TRIGGER_DEPLOYMENT.execute({ reason: 'test', userId: 'user-1' });

      expect(result).toContain('Deployment started successfully');
      expect(result).toContain('build-123');
      expect(incrementDeployCount).toHaveBeenCalled();
    });

    it('should reject if limit reached', async () => {
      vi.mocked(getDeployCountToday).mockResolvedValue(10);
      ddbMock.on(GetCommand).resolves({ Item: { value: 10 } }); // limit

      const result = await TRIGGER_DEPLOYMENT.execute({ reason: 'test', userId: 'user-1' });

      expect(result).toContain('CIRCUIT_BREAKER_ACTIVE');
      expect(codebuildMock.calls()).toHaveLength(0);
    });
  });

  describe('CHECK_HEALTH', () => {
    it('should reward limit if health check passes', async () => {
      // Mock global fetch
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const result = await CHECK_HEALTH.execute({ url: 'http://test.com' });

      expect(result).toContain('HEALTH_OK');
      expect(rewardDeployLimit).toHaveBeenCalled();
    });

    it('should return failure if health check fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

      const result = await CHECK_HEALTH.execute({ url: 'http://test.com' });

      expect(result).toContain('HEALTH_FAILED');
      expect(rewardDeployLimit).not.toHaveBeenCalled();
    });
  });

  describe('TRIGGER_ROLLBACK', () => {
    it('should trigger rollback build', async () => {
      codebuildMock.on(StartBuildCommand).resolves({});

      const result = await TRIGGER_ROLLBACK.execute({ reason: 'failed deploy' });

      expect(result).toContain('ROLLBACK_SUCCESSFUL');
      expect(codebuildMock.calls()).toHaveLength(1);
    });
  });
});