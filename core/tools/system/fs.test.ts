import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { runShellCommand, runTests } from './fs';

const s3Mock = mockClient(S3Client);

vi.mock('sst', () => ({
  Resource: {
    StagingBucket: { name: 'test-bucket' },
    Deployer: { name: 'test-deployer' },
  },
}));

vi.mock('../../lib/constants', () => ({
  STORAGE: {
    TMP_STAGING_ZIP: '/tmp/staging.zip',
    STAGING_ZIP: 'staging.zip',
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

  describe('runShellCommand', () => {
    it('has correct tool definition', () => {
      expect(runShellCommand.name).toBe('runShellCommand');
      expect(runShellCommand.description).toBeDefined();
      expect(runShellCommand.parameters).toBeDefined();
    });

    it('executes command and returns output', async () => {
      const result = await runShellCommand.execute({ command: 'echo hello' });
      expect(result).toContain('Output:');
      expect(result).toContain('hello');
    });

    it('has required command parameter', () => {
      expect(runShellCommand.parameters.required).toContain('command');
    });

    it('handles command execution failure', async () => {
      // Override mock to throw error for this test
      mockExecAsync = async () => {
        throw new Error('Command failed');
      };

      const result = await runShellCommand.execute({ command: 'invalid' });
      expect(result).toContain('Execution FAILED');
    });
  });

  describe('runTests', () => {
    it('has correct tool definition', () => {
      expect(runTests.name).toBe('runTests');
      expect(runTests.description).toBeDefined();
      expect(runTests.parameters).toBeDefined();
    });

    it('runs tests and returns results', async () => {
      const result = await runTests.execute();
      expect(result).toContain('Test Results:');
      expect(result).toContain('hello');
    });

    it('handles test failure', async () => {
      // Override mock to throw error for this test
      mockExecAsync = async () => {
        throw new Error('Tests failed');
      };

      const result = await runTests.execute();
      expect(result).toContain('Tests FAILED');
    });
  });
});
