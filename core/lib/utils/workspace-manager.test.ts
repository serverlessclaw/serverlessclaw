import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { createWorkspace, createMergeWorkspace, cleanupWorkspace } from './workspace-manager';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    cp: vi.fn().mockImplementation(async (src, dest) => {
      await actual.mkdir(dest, { recursive: true });
    }),
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
