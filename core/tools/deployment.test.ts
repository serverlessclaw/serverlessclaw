import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TRIGGER_DEPLOYMENT } from './deployment';

const codebuildMock = mockClient(CodeBuildClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    Deployer: { name: 'test-deployer' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('../lib/deploy-stats', () => ({
  getDeployCountToday: vi.fn(),
  incrementDeployCount: vi.fn(),
}));

vi.mock('../lib/circuit-breaker', () => ({
  getCircuitBreaker: vi.fn(() => ({
    canProceed: vi.fn(),
    recordFailure: vi.fn(),
  })),
}));

import { getDeployCountToday, incrementDeployCount } from '../lib/deploy-stats';
import { getCircuitBreaker } from '../lib/circuit-breaker';

describe('Deployment Tools', () => {
  beforeEach(() => {
    codebuildMock.reset();
    ddbMock.reset();
    vi.clearAllMocks();
  });

  describe('TRIGGER_DEPLOYMENT', () => {
    it('has correct tool definition', () => {
      expect(TRIGGER_DEPLOYMENT.name).toBe('triggerDeployment');
      expect(TRIGGER_DEPLOYMENT.description).toBeDefined();
      expect(TRIGGER_DEPLOYMENT.parameters).toBeDefined();
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

      const result = await TRIGGER_DEPLOYMENT.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('Deployment started successfully');
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

      const result = await TRIGGER_DEPLOYMENT.execute({
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

      const result = await TRIGGER_DEPLOYMENT.execute({
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

      const result = await TRIGGER_DEPLOYMENT.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('Failed to trigger deployment');
    });
  });
});
