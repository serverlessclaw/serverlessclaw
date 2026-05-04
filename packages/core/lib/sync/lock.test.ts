import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSystemSyncLock } from './orchestrator';
import { existsSync, promises as fs } from 'fs';

describe('FileSystemSyncLock', () => {
  const lockDir = '.sst/test_locks';
  const lock = new FileSystemSyncLock(lockDir);
  const resourceId = 'test-resource';

  beforeEach(async () => {
    if (existsSync(lockDir)) {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(lockDir)) {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  });

  it('should acquire and release a lock', async () => {
    const acquired = await lock.acquire(resourceId);
    expect(acquired).toBe(true);
    expect(await lock.isLocked(resourceId)).toBe(true);

    await lock.release(resourceId);
    expect(await lock.isLocked(resourceId)).toBe(false);
  });

  it('should not acquire an already held lock', async () => {
    const first = await lock.acquire(resourceId);
    expect(first).toBe(true);

    const second = await lock.acquire(resourceId);
    expect(second).toBe(false);
  });

  it('should expire an old lock', async () => {
    await lock.acquire(resourceId, 60000);
    const lockPath = (lock as any).getLockPath(resourceId);

    // Manually set mtime to 2 minutes ago

    const past = new Date(Date.now() - 120000);
    await fs.utimes(lockPath, past, past);

    const acquired = await lock.acquire(resourceId, 60000);
    expect(acquired).toBe(true);
  });
});
