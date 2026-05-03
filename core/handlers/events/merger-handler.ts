import { logger } from '../../lib/logger';
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
export function extractPatch(result: string | null | undefined): string | null {
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
 * Result of a patch merge operation.
 */
export interface MergeResult {
  success: boolean;
  appliedCount: number;
  totalCount: number;
  appliedPatches: string[];
  failedPatches: Array<{ agentId: string; taskId: string; error: string; patch: string }>;
  deploymentTriggered: boolean;
  summary: string;
}

/**
 * Handles PARALLEL_TASK_COMPLETED events with aggregationType 'merge_patches'.
 *
 * Applies git patches from parallel Coder agents sequentially onto a fresh trunk clone.
 * Returns a detailed MergeResult for the orchestrator to decide on next steps (e.g. LLM reconciliation).
 *
 * @param eventDetail - The parallel task completed event detail.
 * @returns A promise resolving to the result of the merge operation.
 */
export async function handlePatchMerge(eventDetail: Record<string, unknown>): Promise<MergeResult> {
  const { userId, sessionId, traceId, initiatorId, results } = eventDetail as {
    userId: string;
    sessionId?: string;
    traceId?: string;
    initiatorId?: string;
    results: PatchResult[];
  };

  const emptyResult: MergeResult = {
    success: false,
    appliedCount: 0,
    totalCount: 0,
    appliedPatches: [],
    failedPatches: [],
    deploymentTriggered: false,
    summary: 'No patches to merge.',
  };

  if (!initiatorId) {
    logger.info('Merger: No initiatorId, skipping merge.');
    return emptyResult;
  }

  const successResults = results.filter((r) => r.status === 'success');
  if (successResults.length === 0) {
    logger.info('Merger: No successful results to merge.');
    return { ...emptyResult, summary: 'MERGE_SKIPPED: No successful coder results to merge.' };
  }

  // Extract patches from results
  const patchesToApply: Array<{ taskId: string; agentId: string; patch: string }> = [];
  for (const result of successResults) {
    const patch = result.patch ?? extractPatch(result.result);
    if (patch && patch.trim().length > 0) {
      patchesToApply.push({ taskId: result.taskId, agentId: result.agentId, patch });
    }
  }

  if (patchesToApply.length === 0) {
    logger.info('Merger: No patches found in successful results.');
    return {
      ...emptyResult,
      summary: 'MERGE_SKIPPED: Successful results contained no patches to apply.',
    };
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
    const failedPatches: Array<{ agentId: string; taskId: string; error: string; patch: string }> =
      [];

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
        failedPatches.push({ agentId, taskId, error: errorMsg, patch });
      } finally {
        await fs.unlink(patchFile).catch(() => {});
      }
    }

    let deploymentTriggered = false;

    // 3. If patches applied successfully, stage and deploy
    if (appliedPatches.length > 0) {
      try {
        const zipPath = path.join('/tmp', `merged-${traceId ?? 'unknown'}-${Date.now()}.zip`);
        const { createWriteStream } = await import('fs');
        const archiver = (await import('archiver')).default;

        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 9 } });
          output.on('close', () => resolve());
          archive.on('error', (err) => reject(err));
          archive.pipe(output);
          archive.glob('**/*', {
            cwd: mergeDir,
            ignore: ['.git/**', 'node_modules/**'],
            dot: true,
          });
          archive.finalize();
        });

        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { Resource } = await import('sst');
        const s3Client = new S3Client({});
        const typedResource = Resource as unknown as import('../../lib/types/system').SSTResource;
        const stagingBucket = typedResource.StagingBucket?.name;

        if (stagingBucket) {
          const fileBuffer = await fs.readFile(zipPath);
          const zipKey = traceId ? `staged_${traceId}.zip` : STORAGE.STAGING_ZIP;

          logger.info(
            `Merger: Uploading merged changes to S3 bucket: ${stagingBucket} (Key: ${zipKey})`
          );
          await s3Client.send(
            new PutObjectCommand({
              Bucket: stagingBucket,
              Key: zipKey,
              Body: fileBuffer,
            })
          );
          await fs.unlink(zipPath).catch(() => {});

          const { triggerDeployment } = await import('../../tools/infra/deployment');
          await triggerDeployment.execute({
            reason: `Merged ${appliedPatches.length}/${patchesToApply.length} patches from parallel coders`,
            userId,
            traceId: traceId ?? '',
            initiatorId,
            sessionId: sessionId ?? '',
            gapIds: [],
            stagingKey: zipKey,
          });
          deploymentTriggered = true;
        }
      } catch (error) {
        logger.error('Merger: Failed to stage and deploy:', error);
      }
    }

    await cleanupWorkspace(mergeDir);

    const summary = [
      `[AGGREGATED_RESULTS]`,
      `Merge ${failedPatches.length === 0 ? 'Complete' : 'Partial'}: ${appliedPatches.length}/${patchesToApply.length} patches applied`,
      failedPatches.length > 0 ? `Conflicts: ${failedPatches.map((f) => f.taskId).join(', ')}` : '',
      deploymentTriggered ? 'Deployment triggered.' : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: failedPatches.length === 0,
      appliedCount: appliedPatches.length,
      totalCount: patchesToApply.length,
      appliedPatches,
      failedPatches,
      deploymentTriggered,
      summary,
    };
  } catch (error) {
    logger.error('Merger: Unexpected error during patch merge:', error);
    if (mergeDir) await cleanupWorkspace(mergeDir);
    return {
      ...emptyResult,
      summary: `MERGE_FAILED: Unexpected error. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
