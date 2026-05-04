import { STORAGE } from '../constants';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger';
import { getStagingBucketName } from './resource-helpers';

/**
 * Common workspace setup logic.
 * Copies the deployment package to a writable /tmp directory and initializes Git.
 */
async function setupWorkspace(
  basePath: string,
  traceId: string,
  commitMsg: string,
  applyStagedChanges: boolean = false,
  stagingKey?: string
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

  // 3. Symlink node_modules for test execution
  // We symlink instead of copy to save space and time in /tmp.
  try {
    const targetNodeModules = path.join(process.cwd(), 'node_modules');
    const wsNodeModules = path.join(workspacePath, 'node_modules');
    await fs.symlink(targetNodeModules, wsNodeModules, 'dir');
  } catch (error) {
    logger.warn(`Failed to symlink node_modules to workspace: ${error}`);
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

  // 5. Apply staged changes from S3 if requested (fixes parallel/merger build failures)
  // We do this AFTER git init so these changes appear as unstaged modifications.
  // This ensures stageChanges will re-upload them alongside the agent's new fixes.
  if (applyStagedChanges) {
    try {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const stagingBucket = getStagingBucketName();

      if (stagingBucket) {
        const s3Client = new S3Client({});
        const zipKey = stagingKey || (traceId ? `staged_${traceId}.zip` : STORAGE.STAGING_ZIP);
        logger.info(`Fetching staged changes from S3 bucket: ${stagingBucket} (Key: ${zipKey})`);
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: stagingBucket,
            Key: zipKey,
          })
        );

        if (response.Body) {
          const zipPath = path.join(workspacePath, 'staged_changes.zip');
          const fileBuffer = await response.Body.transformToByteArray();
          await fs.writeFile(zipPath, Buffer.from(fileBuffer));

          logger.info(`Applying staged changes to workspace...`);
          execSync(`unzip -o staged_changes.zip && rm staged_changes.zip`, {
            cwd: workspacePath,
            stdio: 'ignore',
          });
        }
      }
    } catch (e) {
      logger.warn(`Failed to apply staged changes to workspace: ${e}`);
    }
  }

  return workspacePath;
}

/**
 * Creates a writable agent workspace in /tmp.
 */
export async function createWorkspace(
  traceId: string,
  applyStagedChanges: boolean = false,
  stagingKey?: string
): Promise<string> {
  return setupWorkspace(
    STORAGE.WORKSPACE_BASE,
    traceId,
    'workspace init',
    applyStagedChanges,
    stagingKey
  );
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
