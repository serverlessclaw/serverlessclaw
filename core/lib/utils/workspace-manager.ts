import { STORAGE } from '../constants';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger';

/**
 * Common workspace setup logic.
 * Copies the deployment package to a writable /tmp directory and initializes Git.
 */
async function setupWorkspace(
  basePath: string,
  traceId: string,
  commitMsg: string
): Promise<string> {
  const workspacePath = `${basePath}-${traceId}-${Date.now()}`;
  await fs.rm(workspacePath, { recursive: true, force: true });

  // 1. Copy the deployment package (ignoring heavy/unnecessary folders)
  logger.info(`Copying workspace to ${workspacePath}...`);
  await fs.cp(process.cwd(), workspacePath, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(process.cwd(), src);
      return (
        !rel.startsWith('node_modules') &&
        !rel.startsWith('.sst') &&
        !rel.startsWith('.git') &&
        !rel.startsWith('.next') &&
        !rel.startsWith('coverage') &&
        !rel.startsWith('.turbo')
      );
    },
  });

  // 2. Fix Read-Only permissions inherited from Lambda's /var/task
  try {
    execSync(`chmod -R u+w "${workspacePath}"`, { stdio: 'ignore' });
  } catch {
    // Ignore errors if chmod fails (e.g., on some OSes or already writable)
  }

  // 3. Symlink node_modules for local `sst dev` compatibility
  const localNodeModules = path.join(process.cwd(), 'node_modules');
  if (existsSync(localNodeModules)) {
    try {
      await fs.symlink(localNodeModules, path.join(workspacePath, 'node_modules'));
    } catch (e) {
      logger.warn(`Failed to symlink node_modules: ${e}`);
    }
  }

  // 4. Initialize Git and create the base commit
  // Required because Coder Agent tools like generatePatch need a Git repo.
  // We also configure a local user to avoid "Author identity unknown" errors.
  try {
    execSync(
      `git init -q && git config user.email "agent@claw.local" && git config user.name "Claw Agent" && git add -A && git commit -q -m "${commitMsg}"`,
      { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 }
    );
  } catch (error) {
    logger.error(`Failed to initialize git in workspace: ${error}`);
    throw new Error(
      `WORKSPACE_GIT_INIT_FAILED: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return workspacePath;
}

/**
 * Creates a writable agent workspace in /tmp.
 */
export async function createWorkspace(traceId: string): Promise<string> {
  return setupWorkspace(STORAGE.WORKSPACE_BASE, traceId, 'workspace init');
}

/**
 * Creates a writable merger workspace in /tmp.
 */
export async function createMergeWorkspace(traceId: string): Promise<string> {
  return setupWorkspace(STORAGE.MERGE_BASE, traceId, 'merge base');
}

/**
 * Removes an ephemeral workspace.
 */
export async function cleanupWorkspace(wsPath: string): Promise<void> {
  if (wsPath.startsWith('/tmp/workspace-') || wsPath.startsWith('/tmp/merge-')) {
    await fs.rm(wsPath, { recursive: true, force: true }).catch((e) => {
      logger.warn(`Failed to cleanup workspace ${wsPath}: ${e}`);
    });
  }
}
