import { toolDefinitions } from './definitions/index';
import { ConfigManager } from '../lib/registry/config';
import { emitEvent } from '../lib/utils/bus';
import { EventType } from '../lib/types/agent';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * Lists all registered agents and their current status.
 */
export const LIST_AGENTS = {
  ...toolDefinitions.listAgents,
  execute: async (): Promise<string> => {
    const { AgentRegistry } = await import('../lib/registry');
    const configs = await AgentRegistry.getAllConfigs();

    const summary = Object.values(configs)
      .filter((a) => a.enabled)
      .map((a) => `- [${a.id}] ${a.name}: ${a.description} (Backbone: ${a.isBackbone ?? false})`)
      .join('\n');

    return summary ?? 'No enabled agents found in the registry.';
  },
};

/**
 * Dispatches a specific task to another agent via EventBridge.
 */
export const DISPATCH_TASK = {
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

    if (!config || !config.enabled) {
      return `FAILED: Agent '${agentId}' is not registered or is disabled.`;
    }

    const { ClawTracer } = await import('../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer();

    try {
      await emitEvent(initiatorId ?? 'main', `${agentId}_task`, {
        userId,
        task,
        metadata,
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId ?? 'main',
        depth: (depth ?? 0) + 1,
        sessionId,
      });
      return `TASK_PAUSED: I have successfully dispatched this task to the **${agentId}** agent. They are processing it now, and I will update you as soon as they respond (Trace: ${childTracer.getTraceId()}).`;
    } catch (error) {
      return `Failed to dispatch task: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Updates the tools assigned to a specific agent.
 */
export const MANAGE_AGENT_TOOLS = {
  ...toolDefinitions.manageAgentTools,
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
 * Updates global system configuration in the ConfigTable.
 */
export const SET_SYSTEM_CONFIG = {
  ...toolDefinitions.setSystemConfig,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { key, value } = args as { key: string; value: string };
    let parsedValue: unknown = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      // Use raw value
    }

    try {
      await ConfigManager.saveRawConfig(key, parsedValue);
      return `Successfully updated system config: ${key} = ${JSON.stringify(parsedValue)}`;
    } catch (error) {
      return `Failed to update system config: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Pauses the current agent and requests clarification from the initiator.
 */
export const SEEK_CLARIFICATION = {
  ...toolDefinitions.seekClarification,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, question, traceId, initiatorId, depth, sessionId, originalTask, task } =
      args as {
        userId: string;
        question: string;
        traceId?: string;
        initiatorId?: string;
        depth?: number;
        sessionId?: string;
        originalTask?: string;
        task?: string;
      };

    try {
      await emitEvent(initiatorId ?? 'main', EventType.CLARIFICATION_REQUEST, {
        userId,
        question,
        traceId,
        initiatorId: initiatorId ?? 'main',
        depth: (depth ?? 0) + 1,
        sessionId,
        originalTask: originalTask ?? task ?? 'Unknown task',
      });
      return `TASK_PAUSED: I've sent a clarification request to **${initiatorId ?? 'main'}**. I'll wait for their response before continuing with your task.`;
    } catch (error) {
      return `Failed to seek clarification: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Provides an answer to a clarification request, resuming the target agent.
 */
export const PROVIDE_CLARIFICATION = {
  ...toolDefinitions.provideClarification,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, agentId, answer, traceId, sessionId, depth, initiatorId, originalTask } =
      args as {
        userId: string;
        agentId: string;
        answer: string;
        traceId?: string;
        sessionId?: string;
        depth?: number;
        initiatorId?: string;
        originalTask: string;
      };

    try {
      await emitEvent('agent.tool', EventType.CONTINUATION_TASK, {
        userId,
        agentId,
        task: `CLARIFICATION_RESPONSE: For your task "${originalTask}", here is the answer: 
        ---
        ${answer}
        ---
        Please proceed with this information.`,
        traceId,
        sessionId,
        depth: (depth ?? 0) + 1,
        initiatorId,
        isContinuation: true,
      });
      return `Clarification provided to ${agentId}. Continuation task emitted.`;
    } catch (error) {
      return `Failed to provide clarification: ${formatErrorMessage(error)}`;
    }
  },
};
