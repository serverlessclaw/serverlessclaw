import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { EventType, GapStatus, AGENT_TYPES } from '../lib/types/agent';
import { BuildStatus } from '../lib/types/constants';
import { SSTResource, TopologyNode } from '../lib/types/system';
import { reportHealthIssue } from '../lib/lifecycle/health';
import { emitEvent, EventPriority } from '../lib/utils/bus';
import { getCircuitBreaker } from '../lib/safety/circuit-breaker';

const codebuild = new CodeBuildClient({});
const logs = new CloudWatchLogsClient({});
const s3 = new S3Client({});
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
    // 1. Get Build from CodeBuild (Primary source for atomic sync)
    const buildResponse = await codebuild.send(
      new BatchGetBuildsCommand({
        ids: [buildId],
      })
    );
    const build = buildResponse.builds?.[0];

    // 2. Get Build Context from DynamoDB (Supplementary source)
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

    // 3. Resolve Metadata (DDB prioritized, CodeBuild Env as fallback)
    const getEnv = (name: string) =>
      build?.environment?.environmentVariables?.find((ev) => ev.name === name)?.value;

    const userId = buildMeta?.initiatorUserId || getEnv('INITIATOR_USER_ID');
    const initiatorId = buildMeta?.initiatorId || 'superclaw';
    const sessionId = buildMeta?.sessionId;
    const originalTask = buildMeta?.task;
    const traceId = buildMeta?.traceId || getEnv('TRACE_ID');
    const workspaceId = buildMeta?.workspaceId;
    const teamId = buildMeta?.teamId;
    const staffId = buildMeta?.staffId;

    let gapIds: string[] = [];
    if (gapsMeta?.content) {
      const parsed = JSON.parse(gapsMeta.content);
      gapIds = Array.isArray(parsed) ? parsed : [];
    }
    if (gapIds.length === 0) {
      const gapIdsEnv = getEnv('GAP_IDS');
      if (gapIdsEnv) {
        try {
          const parsed = JSON.parse(gapIdsEnv);
          gapIds = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          logger.warn('Failed to parse GAP_IDS from environment variables:', e);
        }
      }
    }

    if (!userId) {
      logger.warn(`No initiator found for build ${buildId} in DynamoDB or environment variables.`);
      return;
    }

    if (status === BuildStatus.SUCCEEDED) {
      logger.info(`Build ${buildId} SUCCEEDED. Marking ${gapIds.length} gaps as DEPLOYED.`);
      const { emitMetrics, METRICS } = await import('../lib/metrics');
      emitMetrics([
        METRICS.deploymentCompleted({ success: true, scope: { workspaceId, teamId, staffId } }),
      ]).catch((err) => logger.warn('Metrics emission failed after build success:', err));

      // Reset failure counter on success
      try {
        const cb = getCircuitBreaker();
        await cb.recordSuccess();
      } catch (e) {
        logger.error('Failed to record build success in circuit breaker:', e);
      }

      // Transition gaps to DEPLOYED
      const { EVOLUTION_METRICS } = await import('../lib/metrics/evolution-metrics');
      for (const gapId of gapIds) {
        // PROGRESS -> DEPLOYED: Acquire lock before transition
        const lockAcquired = await memory.acquireGapLock(gapId, AGENT_TYPES.BUILD_MONITOR);
        if (!lockAcquired) {
          logger.warn(
            `[Monitor] Could not acquire lock for gap ${gapId}, skipping transition to DEPLOYED.`
          );
          EVOLUTION_METRICS.recordLockContention(gapId, AGENT_TYPES.BUILD_MONITOR);
          continue;
        }

        try {
          const result = await memory.updateGapStatus(gapId, GapStatus.DEPLOYED);
          if (!result.success) {
            logger.warn(`Failed to transition gap ${gapId} to DEPLOYED: ${result.error}`);
            EVOLUTION_METRICS.recordTransitionRejection(
              gapId,
              GapStatus.PROGRESS,
              GapStatus.DEPLOYED,
              result.error || 'unknown'
            );
          }
        } finally {
          await memory.releaseGapLock(gapId, AGENT_TYPES.BUILD_MONITOR);
        }
      }

      // Handle Emergency Recovery Success
      const isRecovery = getEnv('EMERGENCY_ROLLBACK') === 'true';
      if (isRecovery) {
        logger.info(
          `[RECOVERY] Emergency rollback SUCCEEDED for build ${buildId}. Resetting counters.`
        );
        await memory.resetRecoveryAttemptCount();

        // Notify Brain of successful restoration
        await emitEvent('system.recovery', EventType.OUTBOUND_MESSAGE, {
          source: 'core.monitor',
          userId: userId || 'ADMIN',
          traceId,
          taskId: traceId,
          initiatorId: 'RecoveryMonitor',
          depth: 0,
          timestamp: Date.now(),
          message: `✅ **SYSTEM RESTORED**: Automatic recovery build ${buildId} has successfully restored the system to its Last Known Good state.`,
          agentName: 'RecoveryMonitor',
          memoryContexts: [],
          attachments: [],
          metadata: { buildId, isRecovery: true },
          sessionId: sessionId || `recovery-${Date.now()}`,
        });

        // Trigger post-recovery warmup
        const warmUpFunctions = process.env.WARM_UP_FUNCTIONS;
        const mcpServerArns = process.env.MCP_SERVER_ARNS;
        if (warmUpFunctions || mcpServerArns) {
          try {
            const { WarmupManager } = await import('../lib/warmup');
            const agentArns = warmUpFunctions ? JSON.parse(warmUpFunctions) : {};
            const serverArns = mcpServerArns ? JSON.parse(mcpServerArns) : {};

            const warmupManager = new WarmupManager({
              servers: serverArns,
              agents: agentArns,
              ttlSeconds: 900,
            });

            await warmupManager.smartWarmup({
              agents: Object.keys(agentArns),
              servers: Object.keys(serverArns),
              intent: 'recovery-complete',
              warmedBy: 'recovery',
            });
            logger.info('[RECOVERY] Post-recovery warmup completed successfully');
          } catch (warmErr) {
            logger.warn('[RECOVERY] Failed to trigger post-recovery warmup:', warmErr);
          }
        }
      }

      // Self-Aware Topology Discovery
      const { discoverSystemTopology } = await import('../lib/utils/topology');
      const topology = await discoverSystemTopology();

      try {
        await ConfigManager.saveRawConfig('system_topology', topology);
        logger.info('System topology updated successfully.');

        const infraNodes = topology.nodes.filter(
          (n: TopologyNode) => n.type === 'infra' || n.type === 'dashboard' || n.type === 'bus'
        );
        await ConfigManager.saveRawConfig('infra_config', infraNodes);
        logger.info('Infrastructure Configuration successfully saved to ConfigTable');
      } catch (e) {
        logger.error('Failed to update system topology in ConfigTable:', e);
      }

      // Notify success - wrap gapIds in metadata for QA agent compatibility
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
          workspaceId,
          teamId,
          staffId,
          metadata: { gapIds },
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
      emitMetrics([
        METRICS.deploymentCompleted({ success: false, scope: { workspaceId, teamId, staffId } }),
      ]).catch((err) => logger.warn('Metrics emission failed after build failure:', err));

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
      const MAX_GAP_ATTEMPTS = 3;
      const { EVOLUTION_METRICS: evolMetrics } = await import('../lib/metrics/evolution-metrics');

      for (const gapId of gapIds) {
        // PROGRESS -> OPEN/FAILED: Acquire lock before transition
        const lockAcquired = await memory.acquireGapLock(gapId, AGENT_TYPES.BUILD_MONITOR);
        if (!lockAcquired) {
          logger.warn(
            `[Monitor] Could not acquire lock for gap ${gapId}, skipping failure transition.`
          );
          evolMetrics.recordLockContention(gapId, AGENT_TYPES.BUILD_MONITOR);
          continue;
        }

        try {
          const attempts = await memory.incrementGapAttemptCount(gapId);
          if (attempts >= MAX_GAP_ATTEMPTS) {
            logger.warn(
              `Gap ${gapId} has failed ${attempts} times. Escalating to FAILED to prevent runaway loop.`
            );
            const result = await memory.updateGapStatus(gapId, GapStatus.FAILED);
            if (!result.success) {
              logger.warn(`Failed to transition gap ${gapId} to FAILED: ${result.error}`);
              evolMetrics.recordTransitionRejection(
                gapId,
                GapStatus.PROGRESS,
                GapStatus.FAILED,
                result.error || 'unknown'
              );
            }
          } else {
            logger.info(`Gap ${gapId} attempt ${attempts}/${MAX_GAP_ATTEMPTS}. Reopening.`);
            evolMetrics.recordGapReopen(gapId, attempts);
            const result = await memory.updateGapStatus(gapId, GapStatus.OPEN);
            if (!result.success) {
              logger.warn(`Failed to transition gap ${gapId} to OPEN: ${result.error}`);
              evolMetrics.recordTransitionRejection(
                gapId,
                GapStatus.PROGRESS,
                GapStatus.OPEN,
                result.error || 'unknown'
              );
            }
          }
        } finally {
          await memory.releaseGapLock(gapId, AGENT_TYPES.BUILD_MONITOR);
        }
      }

      // Get logs for failure analysis
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

      // 4. Fetch Failure Manifest if available
      let failureManifest = null;
      const artifactLocation = build?.artifacts?.location;
      if (artifactLocation && artifactLocation.includes('s3://')) {
        try {
          const s3Path = artifactLocation.replace('s3://', '');
          const bucket = s3Path.split('/')[0];
          const prefix = s3Path.split('/').slice(1).join('/');
          const manifestKey = `${prefix}/failure-manifest.json`;

          logger.info(`Attempting to fetch failure manifest from S3: ${bucket}/${manifestKey}`);
          const s3Response = await s3.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: manifestKey,
            })
          );
          const manifestBody = await s3Response.Body?.transformToString();
          if (manifestBody) {
            failureManifest = JSON.parse(manifestBody);
            logger.info('Successfully retrieved failure manifest from S3.');
          }
        } catch (e) {
          logger.warn(
            'Could not retrieve failure manifest from S3 (might not exist or is zipped):',
            e
          );
        }
      }

      // Notify failure - wrap gapIds in metadata for consistency
      await emitEvent(
        'build.monitor',
        EventType.SYSTEM_BUILD_FAILED,
        {
          userId,
          buildId,
          projectName,
          errorLogs: errorLogs.substring(Math.max(0, errorLogs.length - 3000)),
          failureManifest,
          metadata: { gapIds },
          traceId,
          initiatorId,
          sessionId,
          task: originalTask,
          workspaceId,
          teamId,
          staffId,
        },
        { priority: EventPriority.CRITICAL, idempotencyKey: traceId }
      );
    }
  } catch (error) {
    logger.error('Error in BuildMonitor:', error);
    await reportHealthIssue({
      component: 'BuildMonitor',
      issue: `Unhandled error processing build ${buildId}: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'high',
      userId: 'SYSTEM',
      traceId: (event.detail?.traceId as string) ?? 'unknown',
      context: {
        buildId,
        status,
        projectName,
        error: error instanceof Error ? error.stack : String(error),
      },
    });
    throw error;
  }
};
