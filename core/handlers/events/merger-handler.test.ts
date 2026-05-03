import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn().mockReturnValue(''));
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWakeupInitiator = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockEmitTypedEvent = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
const mockCreateMergeWorkspace = vi.hoisted(() => vi.fn().mockResolvedValue('/tmp/mock-merge-dir'));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
}));

vi.mock('../../lib/utils/workspace-manager', () => ({
  createMergeWorkspace: mockCreateMergeWorkspace,
  cleanupWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
  readFile: vi.fn().mockResolvedValue(Buffer.from('zip-content')),
  rm: mockRm,
}));

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class {
      send = () => Promise.resolve({});
    },
    PutObjectCommand: class {
      constructor(public args: unknown) {}
    },
  };
});

vi.mock('sst', () => ({
  Resource: {
    StagingBucket: { name: 'test-staging-bucket' },
  },
}));

vi.mock('../../tools/infra/deployment', () => ({
  triggerDeployment: {
    execute: vi.fn().mockResolvedValue('SUCCESS: Deployment triggered. Build ID: build-123.'),
  },
}));

import { handlePatchMerge } from './merger-handler';

describe('Merger Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('');
  });

  it('should skip merge when no initiatorId is provided', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      overallStatus: 'success',
      results: [],
      taskCount: 0,
      completedCount: 0,
    };

    const result = await handlePatchMerge(eventDetail as any);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('No patches to merge');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should skip merge when no successful results exist', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      overallStatus: 'failed',
      results: [{ taskId: 'task-1', agentId: 'coder', status: 'failed', result: 'Error' }],
      taskCount: 1,
      completedCount: 1,
    };

    const result = await handlePatchMerge(eventDetail as any);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('No successful coder results');
  });

  it('should skip merge when successful results contain no patches', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      sessionId: 'session-789',
      overallStatus: 'success',
      results: [{ taskId: 'task-1', agentId: 'coder', status: 'success', result: 'No patch here' }],
      taskCount: 1,
      completedCount: 1,
    };

    const result = await handlePatchMerge(eventDetail as any);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('no patches');
  });

  it('should clone repo and apply patches when available', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      sessionId: 'session-789',
      overallStatus: 'success',
      results: [
        {
          taskId: 'task-1',
          agentId: 'coder',
          status: 'success',
          result: 'Done',
          patch: 'diff --git a/file.ts b/file.ts\n+added line',
        },
      ],
      taskCount: 1,
      completedCount: 1,
    };

    const result = await handlePatchMerge(eventDetail as any);

    // Should write patch file
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('task-task-1.patch'),
      'diff --git a/file.ts b/file.ts\n+added line',
      'utf-8'
    );

    // Should check and apply patch
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git apply --check'),
      expect.any(Object)
    );

    // Should upload with partitioned key
    const { triggerDeployment } = await import('../../tools/infra/deployment');
    expect(triggerDeployment.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stagingKey: `staged_trace-456.zip`,
      })
    );

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.summary).toContain('1/1 patches applied');
  });

  it('should identify failed patches on conflict', async () => {
    // First patch succeeds, second fails on check
    mockExecSync
      .mockReturnValueOnce('') // patch-1 check
      .mockReturnValueOnce('') // patch-1 apply
      .mockImplementationOnce(() => {
        throw new Error('error: patch failed to apply');
      }); // patch-2 check fails

    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      sessionId: 'session-789',
      overallStatus: 'success',
      results: [
        {
          taskId: 'task-1',
          agentId: 'coder-a',
          status: 'success',
          result: 'Done',
          patch: 'diff --git a/file.ts b/file.ts\n+change A',
        },
        {
          taskId: 'task-2',
          agentId: 'coder-b',
          status: 'success',
          result: 'Done',
          patch: 'diff --git a/file.ts b/file.ts\n+conflicting change',
        },
      ],
      taskCount: 2,
      completedCount: 2,
    };

    const result = await handlePatchMerge(eventDetail as any);

    expect(result.success).toBe(false);
    expect(result.appliedCount).toBe(1);
    expect(result.failedPatches.length).toBe(1);
    expect(result.failedPatches[0].taskId).toBe('task-2');
    expect(result.failedPatches[0].agentId).toBe('coder-b');
  });

  it('should extract patches from result string delimiters', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      sessionId: 'session-789',
      overallStatus: 'success',
      results: [
        {
          taskId: 'task-1',
          agentId: 'coder',
          status: 'success',
          result: 'PATCH_START\ndiff --git a/file.ts b/file.ts\n+change\nPATCH_END',
        },
      ],
      taskCount: 1,
      completedCount: 1,
    };

    const result = await handlePatchMerge(eventDetail as any);

    // Should write the extracted patch
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('task-task-1.patch'),
      'diff --git a/file.ts b/file.ts\n+change',
      'utf-8'
    );
    expect(result.success).toBe(true);
  });

  it('should handle workspace creation failure gracefully', async () => {
    mockCreateMergeWorkspace.mockImplementationOnce(() =>
      Promise.reject(new Error('workspace creation failed'))
    );

    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      sessionId: 'session-789',
      overallStatus: 'success',
      results: [
        {
          taskId: 'task-1',
          agentId: 'coder',
          status: 'success',
          result: 'Done',
          patch: 'diff --git a/file.ts b/file.ts\n+change',
        },
      ],
      taskCount: 1,
      completedCount: 1,
    };

    const result = await handlePatchMerge(eventDetail as any);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('MERGE_FAILED');
  });
});
