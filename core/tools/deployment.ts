import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { Resource } from 'sst';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { toolDefinitions } from './definitions/index';
import { logger } from '../lib/logger';
import { SYSTEM, DYNAMO_KEYS } from '../lib/constants';
import { getDeployCountToday, incrementDeployCount } from '../lib/deploy-stats';
import { formatErrorMessage } from '../lib/utils/error';

const codebuild = new CodeBuildClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ToolsResource {
  ConfigTable: { name: string };
  Deployer: { name: string };
  MemoryTable: { name: string };
}

/**
 * Triggers a new CodeBuild deployment, with daily limits and circuit breaking.
 */
export const TRIGGER_DEPLOYMENT = {
  ...toolDefinitions.triggerDeployment,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const today = new Date().toISOString().split('T')[0];
    const typedResource = Resource as unknown as ToolsResource;

    try {
      const { reason, userId, traceId, initiatorId, sessionId, task, gapIds } = args as {
        reason: string;
        userId: string;
        traceId?: string;
        initiatorId?: string;
        sessionId?: string;
        task?: string;
        gapIds?: string[];
      };
      const count = await getDeployCountToday();

      const { Item: configItem } = await db.send(
        new GetCommand({
          TableName: typedResource.ConfigTable.name,
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
        const { getAgentContext } = await import('../lib/utils/agent-helpers');
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
        LIMIT > 20
          ? `\n⚠️ WARNING: High deployment limit (${LIMIT}) may result in significant LLM token consumption and AWS costs.`
          : '';

      logger.info(`Triggering deployment for reason: ${reason}${warning}`);
      const command = new StartBuildCommand({
        projectName: typedResource.Deployer.name,
      });

      const response = await codebuild.send(command);
      const buildId = response.build?.id;

      if (buildId) {
        // 1. Save Build Metadata
        await db.send(
          new PutCommand({
            TableName: typedResource.MemoryTable.name,
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

        // 2. Save Gap Mapping Atomically (If provided)
        if (gapIds && gapIds.length > 0) {
          logger.info(`Mapping ${gapIds.length} gaps to build ${buildId} atomically.`);
          await db.send(
            new PutCommand({
              TableName: typedResource.MemoryTable.name,
              Item: {
                userId: `BUILD_GAPS#${buildId}`,
                timestamp: 0, // Fixed lookup for Monitor and QA Auditor
                role: 'system',
                content: JSON.stringify(gapIds),
              },
            })
          );
        }
      }

      const incremented = await incrementDeployCount(today, LIMIT);
      if (!incremented) {
        return `CIRCUIT_BREAKER_ACTIVE: Daily deployment limit reached during atomic increment.`;
      }

      return `Deployment started successfully. Build ID: ${buildId}. Reason: ${reason}${warning}`;
    } catch (error) {
      return `Failed to trigger deployment: ${formatErrorMessage(error)}`;
    }
  },
};
