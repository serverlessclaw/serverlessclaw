import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { createWorkspace, createMergeWorkspace, cleanupWorkspace } from './workspace-manager';
import { execSync } from 'child_process';

vi.mock('child_process', () => {
  const mockExecSync = vi.fn((cmd: string) => {
    if (cmd.includes('git init') && (globalThis as any).__FAIL_GIT__) {
      throw new Error('git fail');
    }
  });
  return {
    __esModule: true,
    default: { execSync: mockExecSync },
    execSync: mockExecSync,
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    cp: vi.fn().mockImplementation(async (src, dest) => {
      await actual.mkdir(dest, { recursive: true });
    }),
  };
});

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
    StagingBucket: { name: 'test-staging-bucket' },
  },
}));

const { mockS3Send } = vi.hoisted(() => ({
  mockS3Send: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class MockS3Client {
      send = mockS3Send;
    },
    GetObjectCommand: class MockGetObjectCommand {
      constructor(public input: any) {}
    },
  };
});

describe('WorkspaceManager', () => {
  const traceId = 'test-trace-123';
  let createdPaths: string[] = [];

  afterEach(async () => {
    for (const p of createdPaths) {
      await cleanupWorkspace(p);
    }
    createdPaths = [];
    vi.clearAllMocks();
  });

  it('should create a coder workspace with git initialized', async () => {
    const wsPath = await createWorkspace(traceId);
    createdPaths.push(wsPath);

    expect(wsPath).toContain('/tmp/workspace-test-trace-123');
    expect(existsSync(wsPath)).toBe(true);

    // Should have git init called
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git init -q'),
      expect.objectContaining({ cwd: wsPath })
    );

    // Should have git config called
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git config user.email'),
      expect.any(Object)
    );

    // Should have a commit called
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git commit -q -m "workspace init"'),
      expect.any(Object)
    );
  });

  it('should create a merger workspace', async () => {
    const mergePath = await createMergeWorkspace(traceId);
    createdPaths.push(mergePath);

    expect(mergePath).toContain('/tmp/merge-test-trace-123');
    expect(existsSync(mergePath)).toBe(true);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git commit -q -m "merge base"'),
      expect.any(Object)
    );
  });

  it('should throw Error if git init fails', async () => {
    (global as any).__FAIL_GIT__ = true;
    try {
      await expect(createWorkspace(traceId)).rejects.toThrow('WORKSPACE_GIT_INIT_FAILED');
    } finally {
      (global as any).__FAIL_GIT__ = false;
    }
  });

  it('should apply staged changes from S3 if applyStagedChanges is true', async () => {
    mockS3Send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    });

    // Ensure the mock is used even with dynamic import
    const wsPath = await createWorkspace(traceId, true);
    createdPaths.push(wsPath);

    expect(mockS3Send).toHaveBeenCalled();
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('unzip -o staged_changes.zip'),
      expect.objectContaining({ cwd: wsPath })
    );
  });

  it('should cleanup a workspace', async () => {
    const wsPath = await createWorkspace(traceId);
    expect(existsSync(wsPath)).toBe(true);

    await cleanupWorkspace(wsPath);
    expect(existsSync(wsPath)).toBe(false);
  });

  it('should handle non-existent workspace cleanup gracefully', async () => {
    await expect(cleanupWorkspace('/tmp/workspace-does-not-exist')).resolves.not.toThrow();
  });

  it('should not delete paths outside of /tmp/workspace- or /tmp/merge-', async () => {
    const safePath = path.join(process.cwd(), 'core/lib/utils/dummy-test-dir');
    await fs.mkdir(safePath, { recursive: true });

    await cleanupWorkspace(safePath);

    expect(existsSync(safePath)).toBe(true);
    await fs.rm(safePath, { recursive: true, force: true });
  });
});
