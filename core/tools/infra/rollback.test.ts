import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { rollbackDeployment } from './rollback';

const codebuildMock = mockClient(CodeBuildClient);

vi.mock('sst', () => ({
  Resource: {
    Deployer: { name: 'test-deployer' },
    RollbackProject: { name: 'test-rollback-project' },
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err) => String(err)),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: vi.fn((_fn) => {
      return async () => {
        return { stdout: 'success', stderr: '' };
      };
    }),
  };
});

describe('Rollback Tools', () => {
  beforeEach(() => {
    codebuildMock.reset();
    vi.clearAllMocks();
  });

  describe('rollbackDeployment', () => {
    it('has correct tool definition', () => {
      expect(rollbackDeployment.name).toBe('rollbackDeployment');
      expect(rollbackDeployment.description).toBeDefined();
      expect(rollbackDeployment.parameters).toBeDefined();
    });

    it('has required reason parameter', () => {
      expect(rollbackDeployment.parameters.required).toContain('reason');
    });

    it('triggers rollback successfully', async () => {
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'rollback-123' } });

      const result = await rollbackDeployment.execute({ reason: 'failed deploy' });

      expect(result).toContain('SUCCESS: Rollback triggered');
      expect(codebuildMock.calls()).toHaveLength(1);
    });

    it('has proper description for rollback tool', () => {
      expect(rollbackDeployment.description).toContain('emergency rollback');
    });
  });
});
