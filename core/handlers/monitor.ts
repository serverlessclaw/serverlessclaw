import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { EventType, GapStatus } from '../lib/types/agent';
import { BuildStatus } from '../lib/types/constants';
import { SSTResource, TopologyNode } from '../lib/types/system';
import { reportHealthIssue } from '../lib/health';
import { emitEvent, EventPriority } from '../lib/utils/bus';
import { getCircuitBreaker } from '../lib/circuit-breaker';

const codebuild = new CodeBuildClient({});
const logs = new CloudWatchLogsClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;

/**
 * monitors-codebuild-build-states
 *
 * Monitors CodeBuild build states and transitions associated Gaps to DEPLOYED or FAILED.
 * Sends success or failure events to the system bus for further processing.
 *
 * @param event - The EventBridge event containing CodeBuild detail.
 * @returns A promise that resolves when the build state has been processed.
 */
export const handler = async (event: { detail: Record<string, unknown> }): Promise<void> => {
  logger.info('BuildMonitor received event:', JSON.stringify(event, null, 2));

  // Lazy load large dependencies to break context fragmentation
  const { DynamoMemory } = await import('../lib/memory');
  const { ConfigManager } = await import('../lib/registry/config');
  const memory = new DynamoMemory();

  let buildId = event.detail['build-id'] as string;
  const projectName = event.detail['project-name'] as string;
  const status = event.detail['build-status'] as string;

  // Normalize buildId if it's an ARN
  if (buildId.startsWith('arn:aws:codebuild:')) {
    buildId = buildId.split('/').pop() ?? buildId;
  }

  try {
    // 1. Get Build Context
    const { Items: buildItems } = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        KeyConditionExpression: 'userId = :b',
        ExpressionAttributeValues: { ':b': `BUILD#${buildId}` },
        Limit: 1,
        ScanIndexForward: false,
      })
    );
    const buildMeta = buildItems?.[0];

    const { Items: gapsItems } = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        KeyConditionExpression: 'userId = :g',
        ExpressionAttributeValues: { ':g': `BUILD_GAPS#${buildId}` },
        Limit: 1,
        ScanIndexForward: false,
      })
    );
    const gapsMeta = gapsItems?.[0];

    const userId = buildMeta?.initiatorUserId;
    const initiatorId = buildMeta?.initiatorId;
    const sessionId = buildMeta?.sessionId;
    const originalTask = buildMeta?.task;
    const traceId = buildMeta?.traceId;
    const gapIds: string[] = gapsMeta?.content ? JSON.parse(gapsMeta.content) : [];

    if (!userId) {
      logger.warn(`No initiator found for build ${buildId}`);
      return;
    }

    if (status === BuildStatus.SUCCEEDED) {
      logger.info(`Build ${buildId} SUCCEEDED. Marking ${gapIds.length} gaps as DEPLOYED.`);
      const { emitMetrics, METRICS } = await import('../lib/metrics');
      emitMetrics([METRICS.deploymentCompleted({ success: true })]).catch((err) =>
        logger.warn('Metrics emission failed after build success:', err)
      );

      // Reset failure counter on success
      try {
        const cb = getCircuitBreaker();
        await cb.recordSuccess();
      } catch (e) {
        logger.error('Failed to record build success in circuit breaker:', e);
      }

      // Transition gaps to DEPLOYED
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DEPLOYED);
      }

      // Self-Aware Topology Discovery
      const { discoverSystemTopology } = await import('../lib/utils/topology');
      const topology = await discoverSystemTopology();

      try {
        await ConfigManager.saveRawConfig('system_topology', topology);
        logger.info('System topology updated successfully.');

        const infraNodes = topology.nodes.filter(
          (n: TopologyNode) => n.type === 'infra' || n.type === 'dashboard'
        );
        await ConfigManager.saveRawConfig('infra_config', infraNodes);
        logger.info('Infrastructure Configuration successfully saved to ConfigTable');
      } catch (e) {
        logger.error('Failed to update system topology in ConfigTable:', e);
      }

      // Notify success
      await emitEvent(
        'build.monitor',
        EventType.SYSTEM_BUILD_SUCCESS,
        {
          userId,
          buildId,
          projectName,
          initiatorId,
          sessionId,
          task: originalTask,
          traceId,
        },
        { priority: EventPriority.HIGH }
      );
    } else if (
      [BuildStatus.FAILED, BuildStatus.STOPPED, BuildStatus.TIMED_OUT, BuildStatus.FAULT].includes(
        status as BuildStatus
      )
    ) {
      logger.info(`Build ${buildId} ${status}. Marking ${gapIds.length} gaps as FAILED.`);
      const { emitMetrics, METRICS } = await import('../lib/metrics');
      emitMetrics([METRICS.deploymentCompleted({ success: false })]).catch((err) =>
        logger.warn('Metrics emission failed after build failure:', err)
      );

      // Circuit Breaker: record failure in sliding window
      try {
        const cb = getCircuitBreaker();
        const result = await cb.recordFailure('deploy', { userId, traceId });
        if (result.state === 'open') {
          logger.warn(
            `Circuit Breaker: Opened after ${result.failures.length} failures in sliding window.`
          );
        }
      } catch (e) {
        logger.error('Failed to record build failure in circuit breaker:', e);
        await reportHealthIssue({
          component: 'BuildMonitor',
          issue: 'Failed to record build failure in circuit breaker',
          severity: 'medium',
          userId: userId ?? 'SYSTEM',
          traceId,
          context: { error: String(e), buildId },
        });
      }

      // Transition gaps: increment attempt counter, archive if exhausted, else reopen.
      // This rescues FAILED gaps from being orphaned and prevents an unbounded reopen cycle.
      const MAX_GAP_ATTEMPTS = 3;
      for (const gapId of gapIds) {
        const attempts = await memory.incrementGapAttemptCount(gapId);
        if (attempts >= MAX_GAP_ATTEMPTS) {
          logger.warn(
            `Gap ${gapId} has failed ${attempts} times. Escalating to FAILED to prevent runaway loop.`
          );
          await memory.updateGapStatus(gapId, GapStatus.FAILED);
        } else {
          logger.info(`Gap ${gapId} attempt ${attempts}/${MAX_GAP_ATTEMPTS}. Reopening.`);
          await memory.updateGapStatus(gapId, GapStatus.OPEN);
        }
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
          logEvents.events?.map((e: { message?: string }) => e.message).join('\n') ??
          'Logs are empty.';
      }

      // Notify failure
      await emitEvent(
        'build.monitor',
        EventType.SYSTEM_BUILD_FAILED,
        {
          userId,
          buildId,
          projectName,
          errorLogs: errorLogs.substring(Math.max(0, errorLogs.length - 3000)),
          gapIds,
          traceId,
          initiatorId,
          sessionId,
          task: originalTask,
        },
        { priority: EventPriority.CRITICAL }
      );
    }
  } catch (error) {
    logger.error('Error in BuildMonitor:', error);
  }
};
