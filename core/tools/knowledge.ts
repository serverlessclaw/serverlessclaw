import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import { DynamoMemory } from '../lib/memory';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { InsightCategory, GapStatus } from '../lib/types/index';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventbridge = new EventBridgeClient({});
const memory = new DynamoMemory();

interface ToolsResource {
  ConfigTable: { name: string };
  AgentBus: { name: string };
}

/**
 * Lists all registered agents and their current status.
 */
export const listAgents = {
  ...toolDefinitions.listAgents,
  execute: async (): Promise<string> => {
    const { AgentRegistry } = await import('../lib/registry');
    const configs = await AgentRegistry.getAllConfigs();

    const summary = Object.values(configs)
      .filter((a) => a.enabled)
      .map((a) => `- [${a.id}] ${a.name}: ${a.description} (Backbone: ${a.isBackbone || false})`)
      .join('\n');

    return summary || 'No enabled agents found in the registry.';
  },
};

/**
 * Dispatches a specific task to another agent via EventBridge.
 */
export const dispatchTask = {
  ...toolDefinitions.dispatchTask,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, userId, task, metadata, traceId, initiatorId, depth } = args as {
      agentId: string;
      userId: string;
      task: string;
      metadata?: Record<string, unknown>;
      traceId?: string;
      initiatorId?: string;
      depth?: number;
    };

    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig(agentId);

    if (!config) {
      return `FAILED: Agent '${agentId}' is not registered in the system.`;
    }

    if (!config.enabled) {
      return `FAILED: Agent '${agentId}' is currently disabled.`;
    }

    const nextDepth = (depth || 0) + 1;

    logger.info(
      `Dispatching ${agentId} task (Depth: ${nextDepth}, Initiator: ${initiatorId || 'N/A'}) for user ${userId}: ${task}`
    );
    const typedResource = Resource as unknown as ToolsResource;
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: initiatorId || 'main.agent',
          DetailType: `${agentId}_task`,
          Detail: JSON.stringify({
            userId,
            task,
            metadata,
            traceId,
            initiatorId: initiatorId || 'main.agent',
            depth: nextDepth,
          }),
          EventBusName: typedResource.AgentBus.name,
        },
      ],
    });

    try {
      await eventbridge.send(command);
      return `Task successfully dispatched to ${agentId} agent. Trace ID: ${traceId || 'N/A'}`;
    } catch (error) {
      return `Failed to dispatch task: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Inspects a mechanical trace by ID.
 */
export const inspectTrace = {
  ...toolDefinitions.inspectTrace,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { traceId } = args as { traceId: string };
    if (!traceId) return 'FAILED: No traceId provided.';

    try {
      const { ClawTracer } = await import('../lib/tracer');
      const trace = await ClawTracer.getTrace(traceId);
      if (!trace) return `FAILED: Trace with ID '${traceId}' not found.`;

      const summary = `
[TRACE_INSPECTION]
ID: ${traceId}
STATUS: ${trace.status}
USER: ${trace.userId}
STEPS:
${trace.steps
  .map(
    (s) =>
      `- [${new Date(s.timestamp).toISOString()}] [${s.type.toUpperCase()}] ${
        typeof s.content === 'string' ? s.content : JSON.stringify(s.content)
      }`
  )
  .join('\n')}
      `;
      return summary;
    } catch (error) {
      return `Failed to inspect trace: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Recalls distilled knowledge and lessons from DynamoDB memory.
 */
export const recallKnowledge = {
  ...toolDefinitions.recallKnowledge,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, query, category } = args as {
      userId: string;
      query: string;
      category?: string;
    };
    const results = await memory.searchInsights(userId, query, category as InsightCategory);

    if (results.length === 0) return 'No relevant knowledge found.';

    interface InsightResult {
      content: string;
      metadata: {
        category: string;
        impact: number;
        urgency: number;
      };
    }

    return (results as unknown as InsightResult[])
      .map(
        (r) =>
          `[${r.metadata.category.toUpperCase()}] (Impact: ${r.metadata.impact}/10, Urgency: ${r.metadata.urgency}/10) ${r.content}`
      )
      .join('\n');
  },
};

/**
 * Updates the tools assigned to a specific agent.
 */
export const manageAgentTools = {
  ...toolDefinitions.manageAgentTools,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, toolNames } = args as { agentId: string; toolNames: string[] };
    const typedResource = Resource as unknown as ToolsResource;
    try {
      await db.send(
        new PutCommand({
          TableName: typedResource.ConfigTable.name,
          Item: {
            key: `${agentId}_tools`,
            value: toolNames,
          },
        })
      );
      return `Successfully updated tools for agent ${agentId}: ${toolNames.join(', ')}`;
    } catch (error) {
      return `Failed to update agent tools: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Updates the lifecycle status of a capability gap.
 */
export const manageGap = {
  ...toolDefinitions.manageGap,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { gapId, status } = args as { gapId: string; status: GapStatus };
    try {
      await memory.updateGapStatus(gapId, status);
      return `Successfully updated gap ${gapId} to ${status}`;
    } catch (error) {
      return `Failed to update gap ${gapId}: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Updates global system configuration in the ConfigTable.
 */
export const setSystemConfig = {
  ...toolDefinitions.setSystemConfig,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { key, value } = args as { key: string; value: unknown };
    const typedResource = Resource as unknown as ToolsResource;
    try {
      await db.send(
        new PutCommand({
          TableName: typedResource.ConfigTable.name,
          Item: { key, value },
        })
      );
      return `Successfully updated system config: ${key} = ${JSON.stringify(value)}`;
    } catch (error) {
      return `Failed to update system config: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
