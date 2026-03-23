import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { TRIGGER_ROLLBACK } from './rollback';

const codebuildMock = mockClient(CodeBuildClient);

vi.mock('sst', () => ({
  Resource: {
    Deployer: { name: 'test-deployer' },
  },
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../lib/utils/error', () => ({
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

  describe('TRIGGER_ROLLBACK', () => {
    it('has correct tool definition', () => {
      expect(TRIGGER_ROLLBACK.name).toBe('triggerRollback');
      expect(TRIGGER_ROLLBACK.description).toBeDefined();
      expect(TRIGGER_ROLLBACK.parameters).toBeDefined();
    });

    it('has required reason parameter', () => {
      expect(TRIGGER_ROLLBACK.parameters.required).toContain('reason');
    });

    it('has codebuild connection profile', () => {
      expect(TRIGGER_ROLLBACK.connectionProfile).toContain('codebuild');
    });

    it('triggers rollback successfully', async () => {
      codebuildMock.on(StartBuildCommand).resolves({});

      const result = await TRIGGER_ROLLBACK.execute({ reason: 'failed deploy' });

      expect(result).toContain('ROLLBACK_SUCCESSFUL');
      expect(codebuildMock.calls()).toHaveLength(1);
    });

    it('has proper description for rollback tool', () => {
      expect(TRIGGER_ROLLBACK.description).toContain('emergency rollback');
    });
  });
});
