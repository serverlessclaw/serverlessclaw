import { Resource } from 'sst';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { infraSchema as schema } from './schema';
import { formatErrorMessage } from '../../lib/utils/error';
import { getAgentContext } from '../../lib/utils/agent-helpers';
import { logger } from '../../lib/logger';
import { STORAGE } from '../../lib/constants';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import archiver from 'archiver';

const s3Client = new S3Client({});

/**
 * Compresses modified files into a ZIP and uploads to the S3 staging bucket for CodeBuild.
 */
export const stageChanges = {
  ...schema.stageChanges,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { modifiedFiles, sessionId, skipValidation } = args as {
      modifiedFiles: string[];
      sessionId: string;
      skipValidation: boolean;
    };

    try {
      if (!skipValidation) {
        // Enforce Definition of Done (DoD) verification
        const { memory } = await getAgentContext();
        const history = await memory.getHistory(sessionId);

        const hasValidated = history.some(
          (m) =>
            m.content?.includes('TYPE_CHECK_PASSED') || m.content?.includes('Validation Successful')
        );
        const hasTested = history.some(
          (m) => m.content?.includes('UNIT_TESTS_PASSED') || m.content?.includes('Test Results:')
        );

        if (!hasValidated || !hasTested) {
          return 'FAILED_DOD: Changes must be validated (validateCode) and tested (runTests) before staging.';
        }
      }

      if (!modifiedFiles || modifiedFiles.length === 0) {
        return 'No files to stage.';
      }

      const typedResource = Resource as unknown as import('../../lib/types/system').SSTResource;
      const stagingBucket = typedResource.StagingBucket?.name;
      if (!stagingBucket) return 'FAILED: StagingBucket not linked.';

      const zipPath = path.join('/tmp', `stage-${Date.now()}.zip`);
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        output.on('close', async () => {
          try {
            const fileBuffer = await fs.readFile(zipPath);
            await s3Client.send(
              new PutObjectCommand({
                Bucket: stagingBucket,
                Key: STORAGE.STAGING_ZIP,
                Body: fileBuffer,
              })
            );
            resolve(`SUCCESS: ${modifiedFiles.length} files staged for deployment. (DoD Verified)`);
          } catch (error) {
            resolve(`FAILED_TO_UPLOAD: ${formatErrorMessage(error)}`);
          } finally {
            await fs.unlink(zipPath).catch(() => {});
          }
        });

        archive.on('error', (err: Error) => {
          resolve(`FAILED_TO_ZIP: ${err.message}`);
        });

        archive.pipe(output);
        for (const file of modifiedFiles) {
          const fullPath = path.resolve(process.cwd(), file);
          archive.file(fullPath, { name: file });
        }
        archive.finalize();
      });
    } catch (error) {
      return `FAILED_TO_STAGE: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Triggers a new CodeBuild deployment, with daily limits and circuit breaking.
 */
export const triggerDeployment = {
  ...schema.triggerDeployment,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      reason,
      userId,
      traceId,
      initiatorId,
      sessionId,
      task,
      gapIds,
      deployType = 'autonomous',
    } = args as {
      reason: string;
      userId: string;
      traceId?: string;
      initiatorId?: string;
      sessionId?: string;
      task?: string;
      gapIds?: string[];
      deployType?: 'autonomous' | 'emergency';
    };

    const { getCircuitBreaker } = await import('../../lib/safety/circuit-breaker');
    const { getDeployCountToday, incrementDeployCount } =
      await import('../../lib/metrics/deploy-stats');
    const { SYSTEM, DYNAMO_KEYS } = await import('../../lib/constants');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand, PutCommand } =
      await import('@aws-sdk/lib-dynamodb');
    const { StartBuildCommand, CodeBuildClient } = await import('@aws-sdk/client-codebuild');

    const codebuild = new CodeBuildClient({});
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const cb = getCircuitBreaker();
    const today = new Date().toISOString().split('T')[0];

    try {
      const proceed = await cb.canProceed(deployType);
      if (!proceed.allowed) {
        return `CIRCUIT_BREAKER_ACTIVE: ${proceed.reason}`;
      }

      const count = await getDeployCountToday();

      const typedResource = Resource as unknown as import('../../lib/types/system').SSTResource;
      const configTable = typedResource.ConfigTable?.name;
      const memoryTable = typedResource.MemoryTable?.name;
      const buildProject = typedResource.SelfDeployProject?.name || typedResource.Deployer?.name;

      if (!configTable || !memoryTable || !buildProject) {
        return 'FAILED: Infrastructure resources not fully linked.';
      }

      const { Item: configItem } = await db.send(
        new GetCommand({
          TableName: configTable,
          Key: { key: DYNAMO_KEYS.DEPLOY_LIMIT },
        })
      );

      let LIMIT: number = SYSTEM.DEFAULT_DEPLOY_LIMIT;
      if (configItem?.value) {
        const customLimit = parseInt(configItem.value, 10);
        if (!isNaN(customLimit)) {
          LIMIT = Math.min(SYSTEM.MAX_DEPLOY_LIMIT, Math.max(1, customLimit));
        }
      }

      if (count >= LIMIT) {
        return `CIRCUIT_BREAKER_ACTIVE: Daily deployment limit reached (${LIMIT}). Autonomous deployment blocked for today (${today}). Reason for attempt: ${reason}`;
      }

      // Check for exponential backoff on gaps
      if (gapIds && gapIds.length > 0) {
        const { getAgentContext } = await import('../../lib/utils/agent-helpers');
        const { memory } = await getAgentContext();
        for (const gapId of gapIds) {
          const gaps = await memory.getAllGaps();
          const gap = gaps.find((g) => g.id === `GAP#${gapId}` || g.id === gapId);
          if (gap && gap.metadata.retryCount && gap.metadata.retryCount > 0) {
            const backoffTime = Math.pow(2, gap.metadata.retryCount) * 15 * 60 * 1000;
            const lastAttempt = gap.metadata.lastAttemptTime ?? gap.timestamp;
            if (Date.now() - lastAttempt < backoffTime) {
              return `BACKOFF_ACTIVE: Gap ${gapId} is in exponential backoff. Next attempt allowed in ${Math.round((backoffTime - (Date.now() - lastAttempt)) / 60000)} minutes.`;
            }
          }
        }
      }

      const warning =
        LIMIT > 20 ? '\n⚠️ WARNING: High deployment limit may result in significant costs.' : '';
      logger.info(`Triggering deployment for reason: ${reason}${warning}`);

      const envOverrides = [{ name: 'DEPLOY_REASON', value: reason }];
      if (gapIds && gapIds.length > 0) {
        envOverrides.push({ name: 'GAP_IDS', value: JSON.stringify(gapIds) });
      }
      if (userId) {
        envOverrides.push({ name: 'INITIATOR_USER_ID', value: userId });
      }
      if (traceId) {
        envOverrides.push({ name: 'TRACE_ID', value: traceId });
      }

      const build = await codebuild.send(
        new StartBuildCommand({
          projectName: buildProject,
          environmentVariablesOverride: envOverrides,
        })
      );

      const buildId = build.build?.id;
      if (buildId) {
        // Save Build Metadata
        await db.send(
          new PutCommand({
            TableName: memoryTable,
            Item: {
              userId: `BUILD#${buildId}`,
              timestamp: Date.now(),
              initiatorUserId: userId,
              traceId: traceId,
              initiatorId: initiatorId,
              sessionId: sessionId,
              task: task,
            },
          })
        );

        if (gapIds && gapIds.length > 0) {
          await db.send(
            new PutCommand({
              TableName: memoryTable,
              Item: {
                userId: `BUILD_GAPS#${buildId}`,
                timestamp: 0,
                role: 'system',
                content: JSON.stringify(gapIds),
              },
            })
          );
        }
      }

      await incrementDeployCount(today, LIMIT);
      return `SUCCESS: Deployment triggered. Build ID: ${buildId}. Reasoning: ${reason}${warning}`;
    } catch (error) {
      await cb.recordFailure('deploy', { userId, traceId });
      return `FAILED_TO_DEPLOY: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Triggers a full infrastructure rebuild via CodeBuild.
 */
export const triggerInfraRebuild = {
  ...schema.triggerInfraRebuild,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { reason } = args as { reason: string };
    try {
      const { StartBuildCommand, CodeBuildClient } = await import('@aws-sdk/client-codebuild');
      const client = new CodeBuildClient({});

      const typedResource = Resource as unknown as import('../../lib/types/system').SSTResource;
      const buildProject = typedResource.SelfDeployProject?.name || typedResource.Deployer?.name;
      if (!buildProject) return 'FAILED: SelfDeployProject not linked.';

      const build = await client.send(
        new StartBuildCommand({
          projectName: buildProject,
          environmentVariablesOverride: [
            { name: 'REBUILD_REASON', value: reason },
            { name: 'INFRA_REBUILD', value: 'true' },
          ],
        })
      );

      return `SUCCESS: Infra rebuild triggered. Build ID: ${build.build?.id}. Reasoning: ${reason}`;
    } catch (error) {
      return `FAILED_TO_REBUILD: ${formatErrorMessage(error)}`;
    }
  },
};
