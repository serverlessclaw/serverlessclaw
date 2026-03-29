import { knowledgeSchema } from './schema';
import { ConfigManager } from '../../lib/registry/config';
import { emitEvent } from '../../lib/utils/bus';
import { formatErrorMessage } from '../../lib/utils/error';
import { BACKBONE_REGISTRY } from '../../lib/backbone';

/**
 * Lists all registered agents and their current status.
 */
export const listAgents = {
  ...knowledgeSchema.listAgents,
  execute: async (): Promise<string> => {
    const { AgentRegistry } = await import('../../lib/registry');
    const configs = await AgentRegistry.getAllConfigs();

    const summary = Object.values(configs)
      .filter((a) => a.enabled && a.id !== 'superclaw')
      .map((a) => `- [${a.id}] ${a.name}: ${a.description} (Backbone: ${a.isBackbone ?? false})`)
      .join('\n');

    return summary || 'No enabled agents found in the registry.';
  },
};

/**
 * Dispatches a specific task to another agent via EventBridge.
 */
export const dispatchTask = {
  ...knowledgeSchema.dispatchTask,
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

    if (agentId === 'superclaw') {
      return `FAILED: Cannot dispatch tasks to the 'superclaw' agent (SuperClaw). The superclaw agent is the orchestrator, not a worker node. Please delegate to a specialized agent like 'strategic-planner' or 'coder'.`;
    }

    const { AgentRegistry } = await import('../../lib/registry');
    const config = await AgentRegistry.getAgentConfig(agentId);

    if (!config || !config.enabled) {
      return `FAILED: Agent '${agentId}' is not registered or is disabled.`;
    }

    const { ClawTracer } = await import('../../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer(undefined, agentId);

    try {
      await emitEvent(initiatorId ?? 'superclaw', `${agentId}_task`, {
        userId,
        task,
        metadata,
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId ?? 'superclaw',
        depth: (depth ?? 0) + 1,
        sessionId,
      });
      return `TASK_PAUSED: I have successfully dispatched this task to the **${agentId}** agent. I'll let you know once they have an update.`;
    } catch (error) {
      return `Failed to dispatch task: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Updates the tools assigned to a specific agent.
 */
export const manageAgentTools = {
  ...knowledgeSchema.manageAgentTools,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, toolNames } = args as { agentId: string; toolNames: string[] };
    try {
      await ConfigManager.saveRawConfig(`${agentId}_tools`, toolNames);
      return `Successfully updated tools for agent ${agentId}: ${toolNames.join(', ')}`;
    } catch {
      return `Failed to update agent tools`;
    }
  },
};

/**
 * Creates a new agent in the registry. Cannot override backbone agents.
 */
export const createAgent = {
  ...knowledgeSchema.createAgent,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, name, systemPrompt, provider, model, enabled } = args as {
      agentId: string;
      name: string;
      systemPrompt: string;
      provider?: string;
      model?: string;
      enabled?: boolean;
    };

    if (BACKBONE_REGISTRY[agentId]) {
      return `FAILED: Cannot create agent '${agentId}'. Backbone agents are protected and cannot be overwritten. Use a different agentId.`;
    }

    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const existing = await AgentRegistry.getAgentConfig(agentId);
      if (existing) {
        return `FAILED: Agent '${agentId}' already exists. Use manageAgentTools to modify its tools, or deleteAgent first.`;
      }

      const config = {
        id: agentId,
        name,
        systemPrompt,
        enabled: enabled ?? true,
        isBackbone: false,
        provider: provider ?? 'minimax',
        model: model ?? 'MiniMax-M2.7',
        tools: [],
      };

      await AgentRegistry.saveConfig(agentId, config);
      return `Successfully created agent '${agentId}' (${name}). Agent is ${config.enabled ? 'enabled' : 'disabled'}. Use manageAgentTools to assign tools.`;
    } catch (error) {
      return `Failed to create agent: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Deletes a non-backbone agent from the registry.
 */
export const deleteAgent = {
  ...knowledgeSchema.deleteAgent,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId } = args as { agentId: string };

    if (BACKBONE_REGISTRY[agentId]) {
      return `FAILED: Cannot delete backbone agent '${agentId}'. Backbone agents are protected system components.`;
    }

    try {
      const sst = await import('sst');
      const { ConfigTable } = sst.Resource as { ConfigTable?: { name: string } };
      if (!ConfigTable?.name) {
        return 'FAILED: ConfigTable not linked.';
      }

      const { defaultDocClient } = await import('../../lib/registry/config');
      const { UpdateCommand, DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
      const { DYNAMO_KEYS } = await import('../../lib/constants');

      // Remove agent from agents_config
      await defaultDocClient.send(
        new UpdateCommand({
          TableName: ConfigTable.name,
          Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
          UpdateExpression: 'REMOVE #agents.#id',
          ExpressionAttributeNames: { '#agents': 'value', '#id': agentId },
        })
      );

      // Remove tool overrides
      await defaultDocClient.send(
        new DeleteCommand({
          TableName: ConfigTable.name,
          Key: { key: `${agentId}_tools` },
        })
      );

      return `Successfully deleted agent '${agentId}' and its tool overrides.`;
    } catch (error) {
      return `Failed to delete agent: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Synchronizes the agent registry by refreshing configs and discovering topology.
 */
export const syncAgentRegistry = {
  ...knowledgeSchema.syncAgentRegistry,
  execute: async (): Promise<string> => {
    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const configs = await AgentRegistry.getAllConfigs();

      const { discoverSystemTopology } = await import('../../lib/utils/topology');
      const topology = await discoverSystemTopology();

      const sst = await import('sst');
      const { ConfigTable } = sst.Resource as { ConfigTable?: { name: string } };
      if (ConfigTable?.name) {
        const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
        const { defaultDocClient } = await import('../../lib/registry/config');
        const { DYNAMO_KEYS } = await import('../../lib/constants');
        await defaultDocClient.send(
          new PutCommand({
            TableName: ConfigTable.name,
            Item: { key: DYNAMO_KEYS.SYSTEM_TOPOLOGY, value: topology },
          })
        );
      }

      const agentNames = Object.values(configs)
        .filter((a) => a.enabled)
        .map((a) => `${a.id} (${a.name})`);

      return `Registry synchronized. ${agentNames.length} active agents: ${agentNames.join(', ')}. Topology refreshed.`;
    } catch (error) {
      return `Failed to sync registry: ${formatErrorMessage(error)}`;
    }
  },
};
