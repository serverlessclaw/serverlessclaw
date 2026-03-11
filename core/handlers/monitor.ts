import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { SSTResource, EventType, GapStatus } from '../lib/types/index';
import { DynamoMemory } from '../lib/memory';

const codebuild = new CodeBuildClient({});
const logs = new CloudWatchLogsClient({});
const eventbridge = new EventBridgeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;
const memory = new DynamoMemory();

/**
 * Monitors CodeBuild build states and transitions associated Gaps to DEPLOYED or FAILED.
 * Sends success or failure events to the system bus for further processing.
 *
 * @param event - The EventBridge event containing CodeBuild detail.
 * @returns A promise that resolves when the build state has been processed.
 */
export const handler = async (event: { detail: Record<string, unknown> }): Promise<void> => {
  logger.info('BuildMonitor received event:', JSON.stringify(event, null, 2));

  const buildId = event.detail['build-id'] as string;
  const projectName = event.detail['project-name'] as string;
  const status = event.detail['build-status'] as string;

  try {
    // 1. Get Build Context (Initiator and associated Gaps)
    const { Items } = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        KeyConditionExpression: 'userId = :b or userId = :g',
        ExpressionAttributeValues: {
          ':b': `BUILD#${buildId}`,
          ':g': `BUILD_GAPS#${buildId}`,
        },
      })
    );

    const buildMeta = Items?.find((i) => i.userId.startsWith('BUILD#'));
    const gapsMeta = Items?.find((i) => i.userId.startsWith('BUILD_GAPS#'));

    const userId = buildMeta?.initiatorUserId;
    const gapIds: string[] = gapsMeta ? JSON.parse(gapsMeta.content) : [];

    if (!userId) {
      logger.warn(`No initiator found for build ${buildId}`);
      return;
    }

    if (status === 'SUCCEEDED') {
      logger.info(`Build ${buildId} SUCCEEDED. Marking ${gapIds.length} gaps as DEPLOYED.`);

      // Transition gaps to DEPLOYED (Verification phase starts)
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DEPLOYED);
      }

      // Record live infrastructure explicitly from the deployed bindings
      const infraNodes = [];

      // Known supported Infra Mappings
      if (typedResource.AgentBus)
        infraNodes.push({
          id: 'bus',
          type: 'bus',
          label: 'EventBridge AgentBus',
          description:
            'AWS EventBridge. The asynchronous backbone that allows decoupled agents to communicate via event patterns.',
        });
      if (typedResource.MemoryTable)
        infraNodes.push({
          id: 'memory',
          type: 'infra',
          iconType: 'Database',
          label: 'DynamoDB Memory',
          description:
            'Single-table DynamoDB. Stores session history, distilled knowledge, tactical lessons, and strategic gaps.',
        });
      if (typedResource.StagingBucket)
        infraNodes.push({
          id: 's3',
          type: 'infra',
          iconType: 'Cpu',
          label: 'Staging Bucket',
          description:
            'Temporary storage for zipped source code before deployment. Shared between Coder Agent and CodeBuild.',
        });

      if (typedResource.WebhookApi)
        infraNodes.push({
          id: 'api',
          type: 'api',
          label: 'SuperClaw Webhook',
          description: 'The primary entry point for user interactions via Telegram.',
        });

      // Hardcoded implicit infra
      infraNodes.push({
        id: 'codebuild',
        type: 'infra',
        iconType: 'Terminal',
        label: 'AWS CodeBuild',
        description:
          'Autonomous deployment engine. Runs "sst deploy" in isolated environments to update the system stack.',
      });

      infraNodes.push({
        id: 'dashboard',
        type: 'dashboard',
        label: 'ClawCenter',
        description: 'Next.js management console for monitoring and evolving the system.',
      });

      try {
        const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: { key: 'infra_config', value: infraNodes },
          })
        );
        logger.info('Infrastructure Configuration successfully saved to ConfigTable');
      } catch (e) {
        logger.error('Failed to save infra_config to ConfigTable', e);
      }

      // Notify success
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'build.monitor',
              DetailType: EventType.SYSTEM_BUILD_SUCCESS,
              Detail: JSON.stringify({ userId, buildId, projectName }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
    } else if (status === 'FAILED') {
      logger.info(`Build ${buildId} FAILED. Marking ${gapIds.length} gaps as FAILED.`);

      // Transition gaps to FAILED
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.FAILED);
      }

      // Get logs for failure analysis
      const buildResponse = await codebuild.send(
        new BatchGetBuildsCommand({
          ids: [buildId],
        })
      );

      const build = buildResponse.builds?.[0];
      const logGroupName = build?.logs?.groupName;
      const logStreamName = build?.logs?.streamName;

      let errorLogs = 'Could not retrieve logs.';
      if (logGroupName && logStreamName) {
        const logEvents = await logs.send(
          new GetLogEventsCommand({
            logGroupName,
            logStreamName,
            limit: 50,
            startFromHead: false,
          })
        );
        errorLogs =
          logEvents.events?.map((e: { message?: string }) => e.message).join('\n') ||
          'Logs are empty.';
      }

      // Notify failure
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'build.monitor',
              DetailType: EventType.SYSTEM_BUILD_FAILED,
              Detail: JSON.stringify({
                userId,
                buildId,
                projectName,
                errorLogs: errorLogs.substring(errorLogs.length - 3000),
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
    }
  } catch (error) {
    logger.error('Error in BuildMonitor:', error);
  }
};
