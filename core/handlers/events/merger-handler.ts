import { logger } from '../../lib/logger';
import { wakeupInitiator } from './shared';
import { EventType } from '../../lib/types/agent';
import { STORAGE } from '../../lib/constants';
import * as path from 'path';
import * as fs from 'fs/promises';

interface PatchResult {
  taskId: string;
  agentId: string;
  status: string;
  result?: string | null;
  patch?: string | null;
}

/**
 * Extracts a patch string from a coder result using PATCH_START/END delimiters.
 * Automatically strips markdown code block fences if the LLM included them.
 */
function extractPatch(result: string | null | undefined): string | null {
  if (!result) return null;
  const match = result.match(/PATCH_START\n([\s\S]*?)\nPATCH_END/);
  if (!match) return null;

  let patch = match[1].trim();
  // Strip markdown fences (e.g., ```diff ... ```)
  if (patch.startsWith('```')) {
    patch = patch.replace(/^```[a-z]*\n/, '');
    if (patch.endsWith('```')) {
      patch = patch.slice(0, -3).trim();
    }
  }
  return patch;
}

/**
 * Handles PARALLEL_TASK_COMPLETED events with aggregationType 'merge_patches'.
 *
 * Applies git patches from parallel Coder agents sequentially onto a fresh trunk clone.
 * On conflict, emits a CONTINUATION_TASK back to the failing Coder.
 * On success, stages the merged result and triggers deployment.
 *
 * @param eventDetail - The parallel task completed event detail.
 */
export async function handlePatchMerge(eventDetail: Record<string, unknown>): Promise<void> {
  const {
    userId,
    sessionId,
    traceId,
    initiatorId,
    results,
    taskCount: _taskCount,
  } = eventDetail as {
    userId: string;
    sessionId?: string;
    traceId?: string;
    initiatorId?: string;
    results: PatchResult[];
    taskCount: number;
  };

  if (!initiatorId) {
    logger.info('Merger: No initiatorId, skipping merge.');
    return;
  }

  const successResults = results.filter((r) => r.status === 'success');
  if (successResults.length === 0) {
    logger.info('Merger: No successful results to merge.');
    await wakeupInitiator(
      userId,
      initiatorId,
      'MERGE_SKIPPED: No successful coder results to merge.',
      traceId,
      sessionId,
      1
    );
    return;
  }

  // Extract patches from results
  const patchesToApply: Array<{ taskId: string; agentId: string; patch: string }> = [];
  for (const result of successResults) {
    // Try extracting from the patch field first, then from the result string
    const patch = result.patch ?? extractPatch(result.result);
    if (patch && patch.trim().length > 0) {
      patchesToApply.push({ taskId: result.taskId, agentId: result.agentId, patch });
    }
  }

  if (patchesToApply.length === 0) {
    logger.info('Merger: No patches found in successful results.');
    await wakeupInitiator(
      userId,
      initiatorId,
      'MERGE_SKIPPED: Successful results contained no patches to apply.',
      traceId,
      sessionId,
      1
    );
    return;
  }

  // 1. Prepare writable merger workspace in /tmp
  const { createMergeWorkspace, cleanupWorkspace } =
    await import('../../lib/utils/workspace-manager');
  let mergeDir: string | undefined;

  try {
    mergeDir = await createMergeWorkspace(traceId ?? `unknown-${Date.now()}`);
    const { execSync } = await import('child_process');

    // 2. Apply patches sequentially
    const appliedPatches: string[] = [];
    const failedPatches: Array<{ agentId: string; taskId: string; error: string }> = [];

    for (const { taskId, agentId, patch } of patchesToApply) {
      const patchFile = path.join(mergeDir, `task-${taskId}.patch`);

      try {
        await fs.writeFile(patchFile, patch, 'utf-8');

        // Dry-run check first
        execSync(`git apply --check "${patchFile}"`, {
          cwd: mergeDir,
          encoding: 'utf-8',
          timeout: 30000,
        });

        // Apply for real
        execSync(`git apply "${patchFile}"`, {
          cwd: mergeDir,
          encoding: 'utf-8',
          timeout: 30000,
        });

        appliedPatches.push(taskId);
        logger.info(`Merger: Successfully applied patch for task ${taskId} (agent: ${agentId}).`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`Merger: Patch conflict for task ${taskId} (agent: ${agentId}): ${errorMsg}`);
        failedPatches.push({ agentId, taskId, error: errorMsg });
      } finally {
        // Clean up patch file
        await fs.unlink(patchFile).catch(() => {});
      }
    }

    // 3. Handle conflicts — emit CONTINUATION_TASK to each failing coder
    for (const failed of failedPatches) {
      try {
        const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
        await emitTypedEvent('merger', EventType.CONTINUATION_TASK, {
          userId,
          agentId: failed.agentId,
          task:
            `Merge conflict encountered applying your patch for task ${failed.taskId}. ` +
            `The trunk has moved on due to other agents' changes. ` +
            `Error: ${failed.error}. ` +
            `Please review the current codebase state and regenerate your changes.`,
          traceId,
          sessionId,
          initiatorId: 'merger',
          isContinuation: true,
          depth: 2,
        });
      } catch (emitError) {
        logger.error(`Merger: Failed to emit CONTINUATION_TASK for ${failed.agentId}:`, emitError);
      }
    }

    // 4. If patches applied successfully, stage and deploy
    if (appliedPatches.length > 0) {
      try {
        // Zip the merged result using archiver (Lambda compatible)
        const zipPath = path.join('/tmp', `merged-${traceId ?? 'unknown'}-${Date.now()}.zip`);
        const { createWriteStream } = await import('fs');
        const archiver = (await import('archiver')).default;

        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', () => resolve());
          archive.on('error', (err) => reject(err));

          archive.pipe(output);
          // Zip the directory, ignoring .git and node_modules
          archive.glob('**/*', {
            cwd: mergeDir,
            ignore: ['.git/**', 'node_modules/**'],
            dot: true,
          });
          archive.finalize();
        });

        // Upload to S3
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { Resource } = await import('sst');
        const s3Client = new S3Client({});
        const typedResource = Resource as unknown as import('../../lib/types/system').SSTResource;
        const stagingBucket = typedResource.StagingBucket?.name;

        if (!stagingBucket) {
          logger.error('Merger: StagingBucket not linked.');
          await wakeupInitiator(
            userId,
            initiatorId,
            `MERGE_DEPLOY_FAILED: Applied ${appliedPatches.length} patches but StagingBucket is not linked.`,
            traceId,
            sessionId,
            1
          );
          return;
        }

        const fileBuffer = await fs.readFile(zipPath);
        await s3Client.send(
          new PutObjectCommand({
            Bucket: stagingBucket,
            Key: STORAGE.STAGING_ZIP,
            Body: fileBuffer,
          })
        );

        // Clean up zip
        await fs.unlink(zipPath).catch(() => {});

        logger.info(
          `Merger: Uploaded merged code to S3 (${appliedPatches.length} patches applied).`
        );

        // Trigger deployment
        const { triggerDeployment } = await import('../../tools/infra/deployment');
        const deployResult = await triggerDeployment.execute({
          reason: `Merged ${appliedPatches.length}/${patchesToApply.length} patches from parallel coders`,
          userId,
          traceId: traceId ?? '',
          initiatorId,
          sessionId: sessionId ?? '',
          gapIds: [],
        });

        logger.info(`Merger: Deployment result: ${deployResult}`);
      } catch (error) {
        logger.error('Merger: Failed to stage and deploy:', error);
        await wakeupInitiator(
          userId,
          initiatorId,
          `MERGE_DEPLOY_FAILED: Applied ${appliedPatches.length} patches but deployment failed. Error: ${error instanceof Error ? error.message : String(error)}`,
          traceId,
          sessionId,
          1
        );
        return;
      }
    }

    // 5. Clean up merge directory
    await cleanupWorkspace(mergeDir);

    // 6. Notify initiator
    const summary = [
      `Merge Complete: ${appliedPatches.length}/${patchesToApply.length} patches applied`,
      failedPatches.length > 0
        ? `Conflicts: ${failedPatches.map((f) => f.taskId).join(', ')} (CONTINUATION_TASK sent to coders)`
        : '',
      appliedPatches.length > 0 ? 'Deployment triggered.' : '',
    ]
      .filter(Boolean)
      .join('\n');

    await wakeupInitiator(userId, initiatorId, summary, traceId, sessionId, 1);
  } catch (error) {
    logger.error('Merger: Unexpected error during patch merge:', error);
    await wakeupInitiator(
      userId,
      initiatorId,
      `MERGE_FAILED: Unexpected error. ${error instanceof Error ? error.message : String(error)}`,
      traceId,
      sessionId,
      1
    );
    if (mergeDir) {
      await cleanupWorkspace(mergeDir);
    }
  }
}
