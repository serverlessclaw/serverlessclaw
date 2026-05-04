import { knowledgeSchema } from './schema';
import { ConfigManager } from '../../lib/registry/config';
import { emitEvent } from '../../lib/utils/bus';
import { formatErrorMessage } from '../../lib/utils/error';
import { BACKBONE_REGISTRY } from '../../lib/backbone';
import { LLMProvider, MiniMaxModel } from '../../lib/types/llm';
import { AgentCategory } from '../../lib/types/agent';
import { logger } from '../../lib/logger';

/**
 * Lists all registered agents and their current status.
 */
export const listAgents = {
  ...knowledgeSchema.listAgents,
  execute: async (args: Record<string, unknown> = {}): Promise<string> => {
    const { workspaceId } = args as { workspaceId?: string };
    const { AgentRegistry } = await import('../../lib/registry');
    const configs = await AgentRegistry.getAllConfigs({ workspaceId });

    const summary = Object.values(configs)
      .filter((a) => a.enabled && a.id !== 'superclaw')
      .map((a) => `- [${a.id}] ${a.name}: ${a.description} (Backbone: ${a.isBackbone ?? false})`)
      .join('\n');

    return (
      summary ||
      `No enabled agents found in the registry${workspaceId ? ` for workspace ${workspaceId}` : ''}.`
    );
  },
};

/**
 * Performs a deep cognitive health check by pinging another agent.
 * Verifies EventBus connectivity and peer-to-peer responsiveness.
 */
export const pulseCheck = {
  ...knowledgeSchema.pulseCheck,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { targetAgentId, userId, traceId, nodeId, initiatorId, sessionId, workspaceId } =
      args as {
        targetAgentId: string;
        userId: string;
        traceId?: string;
        nodeId?: string;
        initiatorId?: string;
        sessionId?: string;
        workspaceId?: string;
      };

    const { AgentRegistry } = await import('../../lib/registry');
    const config = await AgentRegistry.getAgentConfig(targetAgentId, { workspaceId });

    if (!config || !config.enabled) {
      return `FAILED: Target agent '${targetAgentId}' is not registered or disabled in workspace ${workspaceId ?? 'global'}.`;
    }

    const { ClawTracer } = await import('../../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer(undefined, targetAgentId);

    try {
      await emitEvent(initiatorId ?? 'superclaw', 'pulse_ping', {
        userId,
        targetAgentId,
        timestamp: Date.now(),
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId ?? 'superclaw',
        sessionId,
        workspaceId,
      });
      return `PULSE_SENT: I've sent a cognitive pulse to **${targetAgentId}**. I'll wait for a pong response to verify health.`;
    } catch (error) {
      return `PULSE_FAILED: EventBus failure - ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Dispatches a specific task to another agent via EventBridge.
 * Supports automatic plan decomposition for complex missions.
 */
export const dispatchTask = {
  ...knowledgeSchema.dispatchTask,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      agentId,
      userId,
      task,
      metadata = {},
      traceId,
      nodeId,
      initiatorId,
      depth,
      sessionId,
      workspaceId,
    } = args as {
      agentId: string;
      userId: string;
      task: string;
      metadata?: Record<string, unknown>;
      traceId?: string;
      nodeId?: string;
      initiatorId?: string;
      depth?: number;
      sessionId?: string;
      workspaceId?: string;
    };

    if (agentId === 'superclaw') {
      return `FAILED: Cannot dispatch tasks to the 'superclaw' agent (SuperClaw). The superclaw agent is the orchestrator, not a worker node. Please delegate to a specialized agent like 'strategic-planner' or 'coder'.`;
    }

    const { AgentRegistry } = await import('../../lib/registry');
    const config = await AgentRegistry.getAgentConfig(agentId, { workspaceId });

    if (!config || !config.enabled) {
      return `FAILED: Agent '${agentId}' is not registered or is disabled in workspace ${workspaceId ?? 'global'}.`;
    }

    const { ClawTracer } = await import('../../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);

    // Dynamic Plan Decomposition for large tasks
    const { decomposePlan } = await import('../../lib/agent/decomposer');
    const gapIds = (metadata.gapIds as string[]) || [];
    const decomposition = await decomposePlan(task, traceId || 'mission', gapIds);

    if (decomposition.wasDecomposed) {
      logger.info(
        `[dispatchTask] Decomposing large mission into ${decomposition.totalSubTasks} sub-tasks.`
      );
      for (const sub of decomposition.subTasks) {
        const childTracer = tracer.getChildTracer(undefined, sub.agentId);
        const eventName = BACKBONE_REGISTRY[sub.agentId]?.isBackbone
          ? `${sub.agentId}_task`
          : `dynamic_${sub.agentId}_task`;

        await emitEvent(initiatorId ?? 'superclaw', eventName, {
          userId,
          task: sub.task,
          metadata: { ...metadata, gapIds: sub.gapIds, order: sub.order, planId: sub.planId },
          traceId: childTracer.getTraceId(),
          nodeId: childTracer.getNodeId(),
          parentId: childTracer.getParentId(),
          initiatorId: initiatorId ?? 'superclaw',
          depth: (depth ?? 0) + 1,
          sessionId,
          workspaceId,
        });
      }
      return `TASK_PAUSED: I have decomposed this mission into ${decomposition.totalSubTasks} sub-tasks and dispatched them to the appropriate agents. Monitoring progress...`;
    }

    // Standard single dispatch
    const childTracer = tracer.getChildTracer(undefined, agentId);
    const eventName = config.isBackbone ? `${agentId}_task` : `dynamic_${agentId}_task`;

    try {
      await emitEvent(initiatorId ?? 'superclaw', eventName, {
        userId,
        task,
        metadata,
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId ?? 'superclaw',
        depth: (depth ?? 0) + 1,
        sessionId,
        workspaceId,
      });
      return `TASK_PAUSED: I have successfully dispatched this task to the **${agentId}** agent. I'll let you know once they have an update.`;
    } catch (error) {
      return `Failed to dispatch task: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Dispatches a technical research task.
 */
export const technicalResearch = {
  ...knowledgeSchema.technicalResearch,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      goal,
      agentId,
      parallel,
      userId,
      traceId,
      nodeId,
      initiatorId,
      depth,
      sessionId,
      workspaceId,
    } = args as {
      goal: string;
      agentId?: string;
      parallel?: boolean;
      userId: string;
      traceId?: string;
      nodeId?: string;
      initiatorId?: string;
      depth?: number;
      sessionId?: string;
      workspaceId?: string;
    };

    const targetAgentId = agentId ?? 'researcher';

    const { ClawTracer } = await import('../../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer(undefined, targetAgentId);

    try {
      await emitEvent(initiatorId ?? 'superclaw', 'research_task', {
        userId,
        task: goal,
        metadata: {
          parallelAllowed: parallel !== false,
        },
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId ?? 'superclaw',
        depth: depth ?? 0,
        sessionId,
        workspaceId,
      });
      return `RESEARCH_INITIATED: I have successfully dispatched a technical research mission to the **${targetAgentId}** agent. I'll let you know once they have an update.`;
    } catch (error) {
      return `Failed to initiate research: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Updates the tools assigned to a specific agent.
 */
export const manageAgentTools = {
  ...knowledgeSchema.manageAgentTools,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, toolNames, workspaceId } = args as {
      agentId: string;
      toolNames: string[];
      workspaceId?: string;
    };
    try {
      await ConfigManager.saveRawConfig(`${agentId}_tools`, toolNames, { workspaceId });
      return `Successfully updated tools for agent ${agentId} in workspace ${workspaceId ?? 'global'}: ${toolNames.join(', ')}`;
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
    const { agentId, name, systemPrompt, provider, model, enabled, workspaceId } = args as {
      agentId: string;
      name: string;
      systemPrompt: string;
      provider?: string;
      model?: string;
      enabled?: boolean;
      workspaceId?: string;
    };

    if (BACKBONE_REGISTRY[agentId]) {
      return `FAILED: Cannot create agent '${agentId}'. Backbone agents are protected and cannot be overwritten. Use a different agentId.`;
    }

    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const existing = await AgentRegistry.getAgentConfig(agentId, { workspaceId });
      if (existing) {
        return `FAILED: Agent '${agentId}' already exists in workspace ${workspaceId ?? 'global'}. Use manageAgentTools to modify its tools, or deleteAgent first.`;
      }

      const config = {
        id: agentId,
        name,
        description: `Custom agent: ${name}`,
        category: AgentCategory.SOCIAL,
        icon: 'User',
        systemPrompt,
        enabled: enabled ?? true,
        isBackbone: false,
        provider: provider ?? LLMProvider.MINIMAX,
        model: model ?? MiniMaxModel.M2_7,
        tools: [],
      };

      await AgentRegistry.saveConfig(agentId, config, { workspaceId });
      return `Successfully created agent '${agentId}' (${name}) in workspace ${workspaceId ?? 'global'}. Agent is ${config.enabled ? 'enabled' : 'disabled'}. Use manageAgentTools to assign tools.`;
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
    const { agentId, workspaceId } = args as { agentId: string; workspaceId?: string };

    if (BACKBONE_REGISTRY[agentId]) {
      return `FAILED: Cannot delete backbone agent '${agentId}'. Backbone agents are protected system components.`;
    }

    try {
      const { DYNAMO_KEYS } = await import('../../lib/constants');

      // Remove agent from agents_config atomically
      await ConfigManager.atomicRemoveFromMap(DYNAMO_KEYS.AGENTS_CONFIG, agentId, [], {
        workspaceId,
      });

      // Remove tool overrides
      await ConfigManager.deleteConfig(`${agentId}_tools`, { workspaceId });

      return `Successfully deleted agent '${agentId}' and its tool overrides from workspace ${workspaceId ?? 'global'}.`;
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
  execute: async (args: Record<string, unknown> = {}): Promise<string> => {
    const { workspaceId } = args as { workspaceId?: string };
    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const configs = await AgentRegistry.getAllConfigs({ workspaceId });

      const { discoverSystemTopology } = await import('../../lib/utils/topology');
      const topology = await discoverSystemTopology();

      const { DYNAMO_KEYS } = await import('../../lib/constants');
      await ConfigManager.saveRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY, topology, { workspaceId });

      const agentNames = Object.values(configs)
        .filter((a) => a.enabled)
        .map((a) => `${a.id} (${a.name})`);

      return `Registry synchronized for workspace ${workspaceId ?? 'global'}. ${agentNames.length} active agents: ${agentNames.join(', ')}. Topology refreshed.`;
    } catch (error) {
      return `Failed to sync registry: ${formatErrorMessage(error)}`;
    }
  },
};
