import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import {
  SSTResource,
  EventType,
  GapStatus,
  TopologyNode,
  TopologyEdge,
  Topology,
  IAgentConfig,
} from '../lib/types/index';
import { DynamoMemory } from '../lib/memory';
import { reportHealthIssue } from '../lib/health';

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

  let buildId = event.detail['build-id'] as string;
  const projectName = event.detail['project-name'] as string;
  const status = event.detail['build-status'] as string;

  // Normalize buildId if it's an ARN (EventBridge sends full ARN, Memory stores projectName:id)
  if (buildId.startsWith('arn:aws:codebuild:')) {
    buildId = buildId.split('/').pop() || buildId;
  }

  try {
    // 1. Get Build Context (Initiator and associated Gaps)
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

    if (status === 'SUCCEEDED') {
      logger.info(`Build ${buildId} SUCCEEDED. Marking ${gapIds.length} gaps as DEPLOYED.`);

      // Reset failure counter on success
      try {
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: { key: 'consecutive_build_failures', value: 0 },
          })
        );
      } catch (e) {
        logger.error('Failed to reset build failure counter:', e);
      }

      // Transition gaps to DEPLOYED (Verification phase starts)
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DEPLOYED);
      }

      // Self-Aware Topology Discovery
      const topology = await discoverSystemTopology();

      try {
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: {
              key: 'system_topology',
              value: topology,
            },
          })
        );
        logger.info('System topology updated successfully.');

        // Legacy infrastructure migration (optional but keeps old UI working for now)
        const infraNodes = topology.nodes.filter(
          (n: TopologyNode) => n.type === 'infra' || n.type === 'dashboard'
        );
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: { key: 'infra_config', value: infraNodes },
          })
        );
        logger.info('Infrastructure Configuration successfully saved to ConfigTable');
      } catch (e) {
        logger.error('Failed to update system topology in ConfigTable:', e);
      }

      // Notify success
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'build.monitor',
              DetailType: EventType.SYSTEM_BUILD_SUCCESS,
              Detail: JSON.stringify({
                userId,
                buildId,
                projectName,
                initiatorId,
                sessionId,
                task: originalTask,
                traceId: traceId,
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
    } else if (['FAILED', 'STOPPED', 'TIMED_OUT', 'FAULT'].includes(status)) {
      logger.info(`Build ${buildId} ${status}. Marking ${gapIds.length} gaps as FAILED.`);

      // 2026 Circuit Breaker Logic
      try {
        const { Item } = await db.send(
          new GetCommand({
            TableName: typedResource.ConfigTable.name,
            Key: { key: 'consecutive_build_failures' },
          })
        );
        const failures = (Item?.value || 0) + 1;
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: { key: 'consecutive_build_failures', value: failures },
          })
        );

        const { Item: thresholdItem } = await db.send(
          new GetCommand({
            TableName: typedResource.ConfigTable.name,
            Key: { key: 'circuit_breaker_threshold' },
          })
        );
        const threshold = thresholdItem?.value || 3;

        if (failures >= threshold) {
          logger.warn(`Circuit Breaker Active! ${failures} build failures. Flipping to HITL mode.`);
          await db.send(
            new PutCommand({
              TableName: typedResource.ConfigTable.name,
              Item: { key: 'evolution_mode', value: 'hitl' },
            })
          );
        }
      } catch (e) {
        logger.error('Failed to update circuit breaker counter:', e);
        await reportHealthIssue({
          component: 'BuildMonitor',
          issue: 'Failed to update circuit breaker counter in ConfigTable',
          severity: 'medium',
          userId: userId || 'SYSTEM',
          traceId: traceId,
          context: { error: String(e), buildId },
        });
      }

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
                errorLogs: errorLogs.substring(Math.max(0, errorLogs.length - 3000)),
                gapIds,
                traceId,
                initiatorId,
                sessionId,
                task: originalTask,
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

/**
 * Dynamically discovers the system topology by scanning SST Resources and the AgentRegistry.
 * Generates a graph of nodes and edges for the System Pulse dashboard.
 */
export async function discoverSystemTopology(): Promise<Topology> {
  try {
    const nodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];

    // 1. Discover Infrastructure from SST Resource
    const resourceMap = Resource as unknown as Record<string, unknown>;
    const infraMap: Record<string, { id: string; type: string; label: string; iconType?: string }> =
      {
        AgentBus: { id: 'bus', type: 'bus', label: 'EventBridge AgentBus' },
        ConfigTable: {
          id: 'config',
          type: 'infra',
          label: 'DynamoDB Config',
          iconType: 'Database',
        },
        MemoryTable: {
          id: 'memory',
          type: 'infra',
          label: 'DynamoDB Memory',
          iconType: 'Database',
        },
        TraceTable: { id: 'trace', type: 'infra', label: 'DynamoDB Trace', iconType: 'Database' },
        StagingBucket: {
          id: 'storage',
          type: 'infra',
          label: 'Staging Bucket',
          iconType: 'Database',
        },
        Deployer: { id: 'codebuild', type: 'infra', label: 'AWS CodeBuild', iconType: 'Terminal' },
      };

    // Special hardcoded nodes that always exist
    nodes.push({
      id: 'dashboard',
      type: 'dashboard',
      label: 'ClawCenter',
      description: 'Next.js management console for monitoring and evolving the system.',
    });

    nodes.push({
      id: 'api',
      type: 'infra',
      label: 'System API',
      iconType: 'Radio',
      description: 'Unified entry point for webhooks and dashboard interactions.',
    });

    nodes.push({
      id: 'monitor',
      type: 'infra',
      label: 'Build Monitor',
      iconType: 'Activity',
      description:
        'Logic-based handler that watches for deployment signals and triggers rollbacks.',
    });

    Object.keys(infraMap).forEach((resKey) => {
      // Allow partial match for Resource keys (e.g. MemoryTableTable vs MemoryTable)
      const actualKey = Object.keys(resourceMap).find(
        (k) => k === resKey || k.startsWith(`${resKey}Table`) || k.startsWith(resKey)
      );

      if (actualKey || resKey === 'Deployer') {
        // Deployer is often just an ARN in context, handle as fallback
        const cfg = infraMap[resKey];
        nodes.push({
          id: cfg.id,
          type: cfg.type as 'infra',
          label: cfg.label,
          iconType: cfg.iconType,
          description: `AWS Resource: ${resKey}`,
        });
      }
    });

    // 2. Discover Agents from Registry
    const { AgentRegistry } = await import('../lib/registry');
    let agents: Record<string, IAgentConfig> = {};
    try {
      agents = (await AgentRegistry.getAllConfigs()) as Record<string, IAgentConfig>;
    } catch (e) {
      logger.error('Failed to load agents for topology, falling back to backbone.', e);
      const { BACKBONE_REGISTRY } = await import('../lib/backbone');
      agents = BACKBONE_REGISTRY as Record<string, IAgentConfig>;
    }

    Object.values(agents).forEach((agent) => {
      nodes.push({
        id: agent.id,
        type: 'agent',
        label: agent.name,
        description: agent.description,
        icon: agent.icon,
        enabled: agent.enabled,
        isBackbone: agent.isBackbone,
      });

      // 3. Generate Edges based on connectionProfile
      if (agent.connectionProfile && agent.enabled) {
        agent.connectionProfile.forEach((targetId: string) => {
          // Map common resource aliases to node IDs (Backward compatibility)
          let actualTarget = targetId;
          if (targetId === 'memoryTable') actualTarget = 'memory';
          if (targetId === 'configTable') actualTarget = 'config';
          if (targetId === 'stagingBucket') actualTarget = 'storage';
          if (targetId === 'deployer') actualTarget = 'codebuild';

          // Special logic for Bus:
          // SuperClaw (main) -> Bus [ORCHESTRATE]
          // Bus -> Sub-Agents [SIGNAL]
          // Sub-Agents -> Bus [RESULT/EMIT]
          if (actualTarget === 'bus' || actualTarget === 'AgentBus') {
            if (agent.id === 'main') {
              edges.push({
                id: `${agent.id}-bus`,
                source: agent.id,
                target: 'bus',
                label: 'ORCHESTRATE',
              });
            } else {
              // Bi-directional for sub-agents
              edges.push({
                id: `bus-${agent.id}`,
                source: 'bus',
                target: agent.id,
                label: 'SIGNAL',
              });
              edges.push({
                id: `${agent.id}-bus`,
                source: agent.id,
                target: 'bus',
                label: 'RESULT',
              });
            }
          } else {
            edges.push({
              id: `${agent.id}-${actualTarget}`,
              source: agent.id,
              target: actualTarget,
            });
          }
        });
      }

      // Every agent connects to the bus by default if not specified
      const hasBusConnection = agent.connectionProfile?.some(
        (t: string) => t === 'bus' || t === 'AgentBus'
      );
      if (!hasBusConnection && agent.id !== 'main' && agent.enabled) {
        edges.push({
          id: `bus-${agent.id}`,
          source: 'bus',
          target: agent.id,
          label: 'SIGNAL',
        });
        edges.push({
          id: `${agent.id}-bus`,
          source: agent.id,
          target: 'bus',
          label: 'RESULT',
        });
      }
    });

    // 3. Add Infrastructure Inflow Edges
    if (nodes.find((n) => n.id === 'codebuild') && nodes.find((n) => n.id === 'bus')) {
      edges.push({
        id: 'codebuild-bus',
        source: 'codebuild',
        target: 'bus',
        label: 'SIGNAL_BUILD',
      });
    }

    if (nodes.find((n) => n.id === 'monitor') && nodes.find((n) => n.id === 'bus')) {
      edges.push({
        id: 'monitor-bus',
        source: 'monitor',
        target: 'bus',
        label: 'SIGNAL_FAILURE',
      });
    }

    if (nodes.find((n) => n.id === 'dashboard') && nodes.find((n) => n.id === 'api')) {
      edges.push({
        id: 'dashboard-api',
        source: 'dashboard',
        target: 'api',
      });
    }

    if (nodes.find((n) => n.id === 'api') && nodes.find((n) => n.id === 'main')) {
      edges.push({
        id: 'api-main',
        source: 'api',
        target: 'main',
        label: 'INVOKE',
      });
    }

    if (nodes.find((n) => n.id === 'api')) {
      // API links to core infra for webhooks
      ['memory', 'config', 'storage', 'bus'].forEach((target) => {
        if (nodes.find((n) => n.id === target)) {
          edges.push({
            id: `api-${target}`,
            source: 'api',
            target: target,
            label: target === 'bus' ? 'SIGNAL' : undefined,
          });
        }
      });
    }

    return { nodes, edges };
  } catch (e) {
    logger.error('Failed to discover system topology:', e);
    return { nodes: [], edges: [] };
  }
}
