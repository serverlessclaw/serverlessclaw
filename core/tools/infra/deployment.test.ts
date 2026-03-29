import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { triggerDeployment, triggerInfraRebuild } from './deployment';

const codebuildMock = mockClient(CodeBuildClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    Deployer: { name: 'test-deployer' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('../../lib/deploy-stats', () => ({
  getDeployCountToday: vi.fn(),
  incrementDeployCount: vi.fn(),
}));

vi.mock('../../lib/circuit-breaker', () => ({
  getCircuitBreaker: vi.fn(() => ({
    canProceed: vi.fn(),
    recordFailure: vi.fn(),
  })),
}));

import { getDeployCountToday, incrementDeployCount } from '../../lib/deploy-stats';
import { getCircuitBreaker } from '../../lib/circuit-breaker';

describe('Deployment Tools', () => {
  beforeEach(() => {
    codebuildMock.reset();
    ddbMock.reset();
    vi.clearAllMocks();
  });

  describe('triggerDeployment', () => {
    it('has correct tool definition', () => {
      expect(triggerDeployment.name).toBe('triggerDeployment');
      expect(triggerDeployment.description).toBeDefined();
      expect(triggerDeployment.parameters).toBeDefined();
    });

    it('triggers deployment successfully when all checks pass', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      vi.mocked(incrementDeployCount).mockResolvedValue(true);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-123' } });
      ddbMock.on(PutCommand).resolves({});

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('SUCCESS: Deployment triggered');
      expect(result).toContain('build-123');
    });

    it('blocks deployment when circuit breaker is active', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({
          allowed: false,
          reason: 'Too many failures',
        }),
        recordFailure: vi.fn(),
      } as any);

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('CIRCUIT_BREAKER_ACTIVE');
      expect(result).toContain('Too many failures');
    });

    it('blocks deployment when daily limit is reached', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(10);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('CIRCUIT_BREAKER_ACTIVE');
      expect(result).toContain('Daily deployment limit reached');
    });

    it('handles errors during deployment', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('FAILED_TO_DEPLOY');
    });

    it('passes metadata as environment variables to CodeBuild', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      vi.mocked(incrementDeployCount).mockResolvedValue(true);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-env-123' } });
      ddbMock.on(PutCommand).resolves({});

      await triggerDeployment.execute({
        reason: 'test env vars',
        userId: 'user-456',
        traceId: 'trace-789',
        gapIds: ['GAP#1', 'GAP#2'],
      });

      expect(codebuildMock.calls()).toHaveLength(1);
      const startCall = codebuildMock.call(0);
      const envVars = (startCall.args[0] as any).input.environmentVariablesOverride;

      expect(envVars).toContainEqual({
        name: 'GAP_IDS',
        value: JSON.stringify(['GAP#1', 'GAP#2']),
      });
      expect(envVars).toContainEqual({ name: 'INITIATOR_USER_ID', value: 'user-456' });
      expect(envVars).toContainEqual({ name: 'TRACE_ID', value: 'trace-789' });
    });
  });

  describe('triggerInfraRebuild', () => {
    it('has correct tool definition', () => {
      expect(triggerInfraRebuild.name).toBe('triggerInfraRebuild');
      expect(triggerInfraRebuild.description).toBeDefined();
      expect(triggerInfraRebuild.requiresApproval).toBe(true);
    });

    it('triggers infra rebuild successfully', async () => {
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'rebuild-456' } });

      const result = await triggerInfraRebuild.execute({
        reason: 'sst.config.ts changed',
      });

      expect(result).toContain('SUCCESS: Infra rebuild triggered');
      expect(result).toContain('rebuild-456');
      expect(result).toContain('sst.config.ts changed');
    });

    it('handles errors during infra rebuild', async () => {
      codebuildMock.on(StartBuildCommand).rejects(new Error('CodeBuild error'));

      const result = await triggerInfraRebuild.execute({
        reason: 'test rebuild',
      });

      expect(result).toContain('FAILED_TO_REBUILD');
    });
  });
});
