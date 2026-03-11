import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { SSTResource, EventType } from '../lib/types/index';
import { DynamoMemory } from '../lib/memory';

const codebuild = new CodeBuildClient({});
const logs = new CloudWatchLogsClient({});
const eventbridge = new EventBridgeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;
const memory = new DynamoMemory();

export const handler = async (event: { detail: Record<string, unknown> }) => {
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
      logger.info(`Build ${buildId} SUCCEEDED. Completing lifecycle for ${gapIds.length} gaps.`);

      // Transition gaps to DONE
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, 'DONE');
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
        await memory.updateGapStatus(gapId, 'FAILED');
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
