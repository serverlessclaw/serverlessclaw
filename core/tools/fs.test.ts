import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { STAGE_CHANGES, RUN_SHELL_COMMAND, RUN_TESTS, setS3Client } from './fs';

const s3Mock = mockClient(S3Client);

vi.mock('sst', () => ({
  Resource: {
    StagingBucket: { name: 'test-bucket' },
    Deployer: { name: 'test-deployer' },
  },
}));

vi.mock('../lib/constants', () => ({
  STORAGE: {
    TMP_STAGING_ZIP: '/tmp/staging.zip',
    STAGING_ZIP: 'staging.zip',
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

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('test')),
}));

vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    pipe: vi.fn(),
    file: vi.fn(),
    finalize: vi.fn(),
    on: vi.fn((event, cb) => {
      if (event === 'close') {
        setTimeout(() => cb(), 0);
      }
    }),
  })),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

// Store reference to control mock behavior in tests

let mockExecAsync: (...args: any[]) => Promise<{ stdout: string; stderr: string }>;

vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: vi.fn(() => {
      return (...args: unknown[]) => mockExecAsync(...args);
    }),
  };
});

describe('Filesystem Tools', () => {
  beforeEach(() => {
    s3Mock.reset();
    vi.clearAllMocks();
    // Default mock behavior
    mockExecAsync = async () => ({ stdout: 'hello', stderr: '' });
  });

  describe('STAGE_CHANGES', () => {
    it('has correct tool definition', () => {
      expect(STAGE_CHANGES.name).toBe('stageChanges');
      expect(STAGE_CHANGES.description).toBeDefined();
      expect(STAGE_CHANGES.parameters).toBeDefined();
    });

    it('returns message when no files to stage', async () => {
      const result = await STAGE_CHANGES.execute({ modifiedFiles: [] });
      expect(result).toBe('No files to stage.');
    });

    it('has required modifiedFiles parameter', () => {
      expect(STAGE_CHANGES.parameters.required).toContain('modifiedFiles');
    });

    it('has storage connection profile', () => {
      expect(STAGE_CHANGES.connectionProfile).toContain('storage');
    });
  });

  describe('RUN_SHELL_COMMAND', () => {
    it('has correct tool definition', () => {
      expect(RUN_SHELL_COMMAND.name).toBe('runShellCommand');
      expect(RUN_SHELL_COMMAND.description).toBeDefined();
      expect(RUN_SHELL_COMMAND.parameters).toBeDefined();
    });

    it('executes command and returns output', async () => {
      const result = await RUN_SHELL_COMMAND.execute({ command: 'echo hello' });
      expect(result).toContain('Output:');
      expect(result).toContain('hello');
    });

    it('has required command parameter', () => {
      expect(RUN_SHELL_COMMAND.parameters.required).toContain('command');
    });

    it('handles command execution failure', async () => {
      // Override mock to throw error for this test
      mockExecAsync = async () => {
        throw new Error('Command failed');
      };

      const result = await RUN_SHELL_COMMAND.execute({ command: 'invalid' });
      expect(result).toContain('Execution FAILED');
    });
  });

  describe('RUN_TESTS', () => {
    it('has correct tool definition', () => {
      expect(RUN_TESTS.name).toBe('runTests');
      expect(RUN_TESTS.description).toBeDefined();
      expect(RUN_TESTS.parameters).toBeDefined();
    });

    it('runs tests and returns results', async () => {
      const result = await RUN_TESTS.execute();
      expect(result).toContain('Test Results:');
      expect(result).toContain('hello');
    });

    it('handles test failure', async () => {
      // Override mock to throw error for this test
      mockExecAsync = async () => {
        throw new Error('Tests failed');
      };

      const result = await RUN_TESTS.execute();
      expect(result).toContain('Tests FAILED');
    });
  });

  describe('setS3Client', () => {
    it('allows injecting a custom S3 client', () => {
      const mockClient = { send: vi.fn() } as any;
      expect(() => setS3Client(mockClient)).not.toThrow();
    });
  });
});
