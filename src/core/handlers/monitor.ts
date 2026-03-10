import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';

const codebuild = new CodeBuildClient({});
const logs = new CloudWatchLogsClient({});
const eventbridge = new EventBridgeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: { detail: Record<string, unknown> }) => {
  console.log('BuildMonitor received event:', JSON.stringify(event, null, 2));

  const buildId = event.detail['build-id'] as string;
  const projectName = event.detail['project-name'] as string;
  const status = event.detail['build-status'] as string;

  if (status !== 'FAILED') return;

  try {
    // 1. Get Initiator User ID from DynamoDB
    const { Item } = await db.send(
      new GetCommand({
        TableName: Resource.MemoryTable.name,
        Key: { userId: `BUILD#${buildId}` },
      })
    );

    const userId = Item?.initiatorUserId;
    if (!userId) {
      console.warn(`No initiator found for build ${buildId}`);
      return;
    }

    // 2. Get Build Logs
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

    // 3. Notify Main Agent via AgentBus
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: 'build.monitor',
          DetailType: 'system_build_failed',
          Detail: JSON.stringify({
            userId,
            buildId,
            projectName,
            errorLogs: errorLogs.substring(errorLogs.length - 3000), // Limit payload size
          }),
          EventBusName: Resource.AgentBus.name,
        },
      ],
    });

    await eventbridge.send(command);
    console.log(`Build failure event dispatched for user ${userId}`);
  } catch (error) {
    console.error('Error in BuildMonitor:', error);
  }
};
