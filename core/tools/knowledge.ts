import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import { DynamoMemory } from '../lib/memory';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { InsightCategory, GapStatus, EventType } from '../lib/types/index';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventbridge = new EventBridgeClient({});

/**
 * Lazy-load memory to avoid issues with Resource availability during unit tests.
 */
function getMemory() {
  return new DynamoMemory();
}

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
    const { agentId, userId, task, metadata, traceId, nodeId, initiatorId, depth, sessionId } =
      args as {
        agentId: string;
        userId: string;
        task: string;
        metadata?: Record<string, unknown>;
        traceId?: string;
        nodeId?: string;
        initiatorId?: string;
        depth?: number;
        sessionId?: string;
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

    // Use ClawTracer to branch the execution path
    const { ClawTracer } = await import('../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer();

    logger.info(
      `Dispatching ${agentId} task (Depth: ${nextDepth}, Node: ${childTracer.getNodeId()}, Parent: ${tracer.getNodeId()}) for user ${userId}: ${task}`
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
            traceId: childTracer.getTraceId(),
            nodeId: childTracer.getNodeId(),
            parentId: childTracer.getParentId(),
            initiatorId: initiatorId || 'main.agent',
            depth: nextDepth,
            sessionId,
          }),
          EventBusName: typedResource.AgentBus.name,
        },
      ],
    });

    try {
      await eventbridge.send(command);
      return `Task successfully dispatched to ${agentId} agent. Trace ID: ${childTracer.getTraceId()} / Node ID: ${childTracer.getNodeId()}`;
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
      const nodes = await ClawTracer.getTrace(traceId);
      if (!nodes || nodes.length === 0) return `FAILED: Trace with ID '${traceId}' not found.`;

      const summary = `
[TRACE_INSPECTION]
ID: ${traceId}
NODES: ${nodes.length}
${nodes
  .map(
    (n) => `
--- NODE: ${n.nodeId} (Parent: ${n.parentId || 'None'}) ---
STATUS: ${n.status}
STEPS:
${n.steps
  .map(
    (s) =>
      `- [${new Date(s.timestamp).toISOString()}] [${s.type.toUpperCase()}] ${
        typeof s.content === 'string' ? s.content : JSON.stringify(s.content)
      }`
  )
  .join('\n')}
`
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
 * Searches for new capabilities based on a query.
 */
export const discoverSkills = {
  ...toolDefinitions.discoverSkills,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { query, category } = args as { query: string; category?: string };
    try {
      const { SkillRegistry } = await import('../lib/skills');
      const results = await SkillRegistry.discoverSkills(query, category);

      if (results.length === 0) return 'No matching skills found in the marketplace.';

      return (
        `Found ${results.length} matching skills:\n` +
        results.map((s) => `- ${s.name}: ${s.description}`).join('\n') +
        '\n\nUSE "installSkill" to add any of these to your current toolset.'
      );
    } catch (error) {
      return `Failed to discover skills: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Installs a new skill into the agent's current toolset.
 */
export const installSkill = {
  ...toolDefinitions.installSkill,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { skillName, agentId } = args as { skillName: string; agentId?: string };
    const targetAgentId = agentId || 'main'; // Default to main if not provided (though injected usually)

    try {
      const { SkillRegistry } = await import('../lib/skills');
      await SkillRegistry.installSkill(targetAgentId, skillName);
      return `Skill '${skillName}' successfully installed for agent ${targetAgentId}. You can now use it.`;
    } catch (error) {
      return `Failed to install skill: ${error instanceof Error ? error.message : String(error)}`;
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
    const results = await getMemory().searchInsights(userId, query, category as InsightCategory);

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
      await getMemory().updateGapStatus(gapId, status);
      return `Successfully updated gap ${gapId} to ${status}`;
    } catch (error) {
      return `Failed to update gap ${gapId}: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Records a new capability gap or system limitation into the evolution pipeline.
 */
export const reportGap = {
  ...toolDefinitions.reportGap,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { content, impact, urgency, category, sessionId, userId } = args as {
      content: string;
      impact?: number;
      urgency?: number;
      category?: InsightCategory;
      sessionId?: string;
      userId: string;
    };

    try {
      const gapId = Date.now().toString();
      const metadata = {
        category: category || InsightCategory.STRATEGIC_GAP,
        confidence: 9,
        impact: impact || 5,
        complexity: 5,
        risk: 5,
        urgency: urgency || 5,
        priority: 5,
      };

      await getMemory().setGap(gapId, content, metadata);

      // Emit EventBridge event for cross-agent coordination
      const typedResource = Resource as unknown as ToolsResource;
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'agent.tool',
              DetailType: EventType.EVOLUTION_PLAN,
              Detail: JSON.stringify({
                gapId,
                details: content,
                metadata,
                contextUserId: userId,
                sessionId,
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );

      return `Successfully recorded new gap: [${gapId}] ${content}`;
    } catch (error) {
      return `Failed to report gap: ${error instanceof Error ? error.message : String(error)}`;
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

/**
 * Registers a new MCP server in the global configuration.
 */
export const registerMCPServer = {
  ...toolDefinitions.registerMCPServer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { serverName, command, env } = args as {
      serverName: string;
      command: string;
      env?: Record<string, string>;
    };
    const typedResource = Resource as unknown as ToolsResource;

    try {
      const { AgentRegistry } = await import('../lib/registry');
      const mcpServers =
        ((await AgentRegistry.getRawConfig('mcp_servers')) as Record<string, unknown>) || {};

      mcpServers[serverName] = env ? { command, env } : command;

      await db.send(
        new PutCommand({
          TableName: typedResource.ConfigTable.name,
          Item: {
            key: 'mcp_servers',
            value: mcpServers,
          },
        })
      );

      return `Successfully registered MCP server '${serverName}'. You can now use 'discoverSkills' to find tools from this server.`;
    } catch (error) {
      return `Failed to register MCP server: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
