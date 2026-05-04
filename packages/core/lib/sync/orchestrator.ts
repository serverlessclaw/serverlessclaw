import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import {
  SyncOrchestrator,
  SyncOptions,
  SyncResult,
  SyncVerification,
  SyncLock,
  SyncConflict,
} from '../types/sync';
import { logger } from '../logger';

const execAsync = promisify(exec);

/**
 * Local file-system based lock for concurrency control.
 * In a distributed environment, this should be replaced with a DynamoDB or Redis lock.
 */
export class FileSystemSyncLock implements SyncLock {
  private lockDir: string;

  constructor(lockDir = '.sst/locks') {
    this.lockDir = lockDir;
  }

  private getLockPath(resourceId: string): string {
    const safeId = resourceId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return join(this.lockDir, `sync_${safeId}.lock`);
  }

  async acquire(resourceId: string, ttlMs = 60000): Promise<boolean> {
    const lockPath = this.getLockPath(resourceId);
    try {
      await fs.mkdir(this.lockDir, { recursive: true });
      if (existsSync(lockPath)) {
        const stats = await fs.stat(lockPath);
        const age = Date.now() - stats.mtimeMs;
        if (age < ttlMs) {
          return false;
        }
        await fs.unlink(lockPath);
      }
      await fs.writeFile(lockPath, JSON.stringify({ acquiredAt: Date.now(), ttlMs }));
      return true;
    } catch (error) {
      logger.error(`Failed to acquire lock for ${resourceId}: ${error}`);
      return false;
    }
  }

  async release(resourceId: string): Promise<void> {
    const lockPath = this.getLockPath(resourceId);
    try {
      if (existsSync(lockPath)) {
        await fs.unlink(lockPath);
      }
    } catch (error) {
      logger.error(`Failed to release lock for ${resourceId}: ${error}`);
    }
  }

  async isLocked(resourceId: string): Promise<boolean> {
    const lockPath = this.getLockPath(resourceId);
    return existsSync(lockPath);
  }
}

export class DefaultSyncOrchestrator implements SyncOrchestrator {
  private async execGit(command: string, cwd: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, { cwd, encoding: 'utf-8' });
      return stdout;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git command failed: ${command}. Error: ${message}`);
    }
  }

  private async ensureRemote(cwd: string, remoteName: string, remoteUrl: string): Promise<void> {
    try {
      await execAsync(`git remote add ${remoteName} ${remoteUrl}`, { cwd });
    } catch {
      await execAsync(`git remote set-url ${remoteName} ${remoteUrl}`, { cwd });
    }
  }

  async verify(options: SyncOptions): Promise<SyncVerification> {
    const { hubUrl, method, prefix } = options;
    const cwd = process.cwd();
    const remoteName = 'hub-verify';

    try {
      await this.ensureRemote(cwd, remoteName, hubUrl);

      const { stderr } = await execAsync(`git fetch ${remoteName} main --depth=1`, { cwd });

      if (stderr.includes('fatal') || stderr.includes('error')) {
        return {
          ok: false,
          reachable: false,
          canSyncWithoutConflict: false,
          message: `Failed to fetch from hub: ${stderr}`,
        };
      }

      const localFiles = new Set<string>();
      if (method === 'subtree' && prefix) {
        try {
          const stdout = await this.execGit(`git ls-files ${prefix}`, cwd);
          stdout
            .split('\n')
            .filter(Boolean)
            .forEach((f: string) => localFiles.add(f));
        } catch {
          return {
            ok: false,
            reachable: true,
            canSyncWithoutConflict: false,
            message: 'Could not list subtree files',
          };
        }
      } else {
        try {
          const stdout = await this.execGit('git ls-files', cwd);
          stdout
            .split('\n')
            .filter(Boolean)
            .forEach((f: string) => localFiles.add(f));
        } catch {
          return {
            ok: false,
            reachable: true,
            canSyncWithoutConflict: false,
            message: 'Could not list files',
          };
        }
      }

      const hasLocalChanges = localFiles.size > 0;

      return {
        ok: true,
        reachable: true,
        canSyncWithoutConflict: !hasLocalChanges,
        message: hasLocalChanges
          ? `Local changes detected in ${localFiles.size} files. Sync may cause conflicts.`
          : 'Sync can proceed without conflicts',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reachable: false,
        canSyncWithoutConflict: false,
        message: `Verification failed: ${message}`,
      };
    }
  }

  async pull(options: SyncOptions): Promise<SyncResult> {
    const { hubUrl, method, prefix, commitMessage, dryRun, lock } = options;
    const cwd = process.cwd();
    const remoteName = 'hub-origin';
    const lockKey = `${hubUrl}_${prefix || 'root'}`;
    const defaultMessage =
      method === 'subtree'
        ? `chore: sync with serverlessclaw hub via subtree (${prefix})`
        : 'chore: sync with serverlessclaw hub via fork merge';

    if (lock) {
      const acquired = await lock.acquire(lockKey);
      if (!acquired) {
        return {
          success: false,
          locked: true,
          message: `Failed to acquire sync lock for ${lockKey}. Another sync might be in progress.`,
        };
      }
    }

    logger.info(`Starting pull sync with hub: ${hubUrl}`);

    try {
      await this.ensureRemote(cwd, remoteName, hubUrl);
      await this.execGit(`git fetch ${remoteName} main`, cwd);

      if (dryRun) {
        return {
          success: true,
          message: 'Dry run: pull would be executed',
        };
      }

      try {
        if (method === 'subtree') {
          await this.execGit(
            `git subtree pull --prefix=${prefix} ${remoteName} main --squash -m "${commitMessage || defaultMessage}"`,
            cwd
          );
        } else {
          await this.execGit(
            `git merge ${remoteName}/main -m "${commitMessage || defaultMessage}"`,
            cwd
          );
        }
      } catch {
        // Parse conflicts
        const conflicts = await this.detectConflicts(cwd);
        return {
          success: false,
          message: `Pull sync failed with conflicts.`,
          conflicts,
        };
      }

      const commitHash = await this.execGit('git rev-parse HEAD', cwd);

      return {
        success: true,
        message: 'Pull sync completed successfully',
        commitHash: commitHash.trim(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Pull sync failed: ${message}`,
      };
    } finally {
      if (lock) {
        await lock.release(lockKey);
      }
    }
  }

  async push(options: SyncOptions): Promise<SyncResult> {
    const { hubUrl, prefix, lock } = options;
    const cwd = process.cwd();
    const remoteName = 'hub-origin';
    const lockKey = `${hubUrl}_${prefix || 'root'}_push`;

    if (lock) {
      const acquired = await lock.acquire(lockKey);
      if (!acquired) {
        return {
          success: false,
          locked: true,
          message: `Failed to acquire push lock for ${lockKey}. Another operation might be in progress.`,
        };
      }
    }

    logger.info(`Starting push sync to hub: ${hubUrl}`);

    try {
      await this.ensureRemote(cwd, remoteName, hubUrl);

      if (options.method === 'subtree') {
        await this.execGit(`git subtree push --prefix=${prefix} ${remoteName} main`, cwd);
      } else {
        await this.execGit(`git push ${remoteName} HEAD:main`, cwd);
      }

      const commitHash = await this.execGit('git rev-parse HEAD', cwd);

      return {
        success: true,
        message: 'Push sync completed successfully',
        commitHash: commitHash.trim(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Push sync failed: ${message}`,
      };
    } finally {
      if (lock) {
        await lock.release(lockKey);
      }
    }
  }

  private async detectConflicts(cwd: string): Promise<SyncConflict[]> {
    try {
      const stdout = await this.execGit('git diff --name-only --diff-filter=U', cwd);
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((file) => ({
          file,
          type: 'content',
          description: 'Merge conflict detected in file contents',
        }));
    } catch {
      return [];
    }
  }
}

export const syncOrchestrator = new DefaultSyncOrchestrator();
export const fileSystemSyncLock = new FileSystemSyncLock();
