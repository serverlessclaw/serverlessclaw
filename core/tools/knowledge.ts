import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import { DynamoMemory } from '../lib/memory';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ITool, InsightCategory, GapStatus } from '../lib/types/index';

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
export const list_agents = {
  ...toolDefinitions.list_agents,
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
export const dispatch_task = {
  ...toolDefinitions.dispatch_task,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, userId, task, metadata } = args as {
      agentId: string;
      userId: string;
      task: string;
      metadata?: Record<string, unknown>;
    };

    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig(agentId);

    if (!config) {
      return `FAILED: Agent '${agentId}' is not registered in the system.`;
    }

    if (!config.enabled) {
      return `FAILED: Agent '${agentId}' is currently disabled.`;
    }

    logger.info(`Dispatching ${agentId} task for user ${userId}: ${task}`);
    const typedResource = Resource as unknown as ToolsResource;
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: 'main.agent',
          DetailType: `${agentId}_task`,
          Detail: JSON.stringify({ userId, task, metadata }),
          EventBusName: typedResource.AgentBus.name,
        },
      ],
    });

    try {
      await eventbridge.send(command);
      return `Task successfully dispatched to ${agentId} agent.`;
    } catch (error) {
      return `Failed to dispatch task: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Recalls distilled knowledge and lessons from DynamoDB memory.
 */
export const recall_knowledge = {
  ...toolDefinitions.recall_knowledge,
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
export const manage_agent_tools = {
  ...toolDefinitions.manage_agent_tools,
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
export const manage_gap = {
  ...toolDefinitions.manage_gap,
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
export const set_system_config = {
  ...toolDefinitions.set_system_config,
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
