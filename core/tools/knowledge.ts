import { toolDefinitions } from './definitions';
import { DynamoMemory } from '../lib/memory';
import { InsightCategory, GapStatus, EventType } from '../lib/types/index';
import { ConfigManager } from '../lib/registry/config';
import { emitEvent } from '../lib/utils/bus';

/**
 * Lazy-load memory.
 */
function getMemory() {
  return new DynamoMemory();
}

/**
 * Lists all registered agents and their current status.
 */
export const getAgentRegistrySummary = {
  ...toolDefinitions.getAgentRegistrySummary,
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

    if (!config || !config.enabled) {
      return `FAILED: Agent '${agentId}' is not registered or is disabled.`;
    }

    const { ClawTracer } = await import('../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer();

    try {
      await emitEvent(initiatorId || 'main.agent', `${agentId}_task`, {
        userId,
        task,
        metadata,
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId || 'main.agent',
        depth: (depth || 0) + 1,
        sessionId,
      });
      return `Task successfully dispatched to ${agentId} agent. Trace ID: ${childTracer.getTraceId()}`;
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

      const summary = nodes
        .map(
          (n) => `
--- NODE: ${n.nodeId} (Parent: ${n.parentId || 'None'}) ---
STATUS: ${n.status}
STEPS:
${n.steps
  .map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) =>
      `- [${new Date(s.timestamp).toISOString()}] [${s.type.toUpperCase()}] ${
        typeof s.content === 'string' ? s.content : JSON.stringify(s.content)
      }`
  )
  .join('\n')}
`
        )
        .join('\n');
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
    const targetAgentId = agentId || 'main';

    try {
      const { SkillRegistry } = await import('../lib/skills');
      await SkillRegistry.installSkill(targetAgentId, skillName);
      return `Skill '${skillName}' successfully installed for agent ${targetAgentId}.`;
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

    return results
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) =>
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
    try {
      await ConfigManager.saveRawConfig(`${agentId}_tools`, toolNames);
      return `Successfully updated tools for agent ${agentId}: ${toolNames.join(', ')}`;
    } catch {
      return `Failed to update agent tools`;
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
 * Records a new capability gap or system limitation.
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
      const metadata = {
        category: category || InsightCategory.STRATEGIC_GAP,
        confidence: 9,
        impact: impact || 5,
        complexity: 5,
        risk: 5,
        urgency: urgency || 5,
        priority: 5,
      };

      const gapIdTimestamp = await getMemory().addInsight(
        'SYSTEM#GLOBAL',
        category || InsightCategory.STRATEGIC_GAP,
        content,
        metadata
      );
      const gapId = gapIdTimestamp.toString();

      await emitEvent('agent.tool', EventType.EVOLUTION_PLAN, {
        gapId,
        details: content,
        metadata,
        contextUserId: userId,
        sessionId,
      });

      return `Successfully recorded new gap: [${gapId}] ${content}`;
    } catch {
      return `Failed to report gap`;
    }
  },
};

/**
 * Updates global system configuration in the ConfigTable.
 */
export const setSystemConfig = {
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
      env: string;
    };

    try {
      let parsedEnv = {};
      if (env) {
        try {
          parsedEnv = typeof env === 'string' ? JSON.parse(env) : env;
        } catch {
          return `Failed to parse environment variables. Ensure 'env' is a valid JSON string.`;
        }
      }

      const { AgentRegistry } = await import('../lib/registry');
      const mcpServers =
        ((await AgentRegistry.getRawConfig('mcp_servers')) as Record<string, unknown>) || {};
      mcpServers[serverName] = { command, env: parsedEnv };

      await ConfigManager.saveRawConfig('mcp_servers', mcpServers);
      return `Successfully registered MCP server '${serverName}'.`;
    } catch (error) {
      return `Failed to register MCP server: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Removes an MCP server and its associated tools.
 */
export const unregisterMCPServer = {
  ...toolDefinitions.unregisterMCPServer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { serverName } = args as { serverName: string };

    try {
      const { AgentRegistry } = await import('../lib/registry');
      const mcpServers =
        ((await AgentRegistry.getRawConfig('mcp_servers')) as Record<string, unknown>) || {};

      if (!mcpServers[serverName]) return `FAILED: MCP server '${serverName}' is not registered.`;

      delete mcpServers[serverName];
      await ConfigManager.saveRawConfig('mcp_servers', mcpServers);

      return `Successfully unregistered MCP server '${serverName}'.`;
    } catch (error) {
      return `Failed to unregister MCP server: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Uninstalls a skill from an agent's toolset.
 */
export const uninstallSkill = {
  ...toolDefinitions.uninstallSkill,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { skillName, agentId } = args as { skillName: string; agentId?: string };
    const targetAgentId = agentId || 'main';

    try {
      const { AgentRegistry } = await import('../lib/registry');
      const currentTools = (await AgentRegistry.getRawConfig(`${targetAgentId}_tools`)) as string[];

      if (!currentTools || !currentTools.includes(skillName)) {
        return `FAILED: Skill '${skillName}' is not installed for agent ${targetAgentId}.`;
      }

      const updatedTools = currentTools.filter((t) => t !== skillName);
      await ConfigManager.saveRawConfig(`${targetAgentId}_tools`, updatedTools);

      return `Successfully uninstalled skill '${skillName}' from agent ${targetAgentId}.`;
    } catch (error) {
      return `Failed to uninstall skill: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Directly saves a new fact or user preference into the system memory.
 */
export const saveMemory = {
  ...toolDefinitions.saveMemory, // Assuming toolDefinitions will also be updated
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { content, category, userId } = args as {
      content: string;
      category: string;
      userId: string;
    };

    const memory = getMemory();
    // Use the baseUserId for user-specific memory, but ensure it's prefixed correctly for scope.
    const baseUserId = userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
    const scopeId = `USER#${baseUserId}`;

    if (category === 'user_preference') {
      // User preferences are now stored as granular memory items.
      await memory.addMemory(scopeId, InsightCategory.USER_PREFERENCE, content);
      return `Successfully saved user preference: ${content}`;
    }

    // Other categories are treated as system knowledge and stored globally.
    const metadata = {
      category: category as InsightCategory,
      confidence: 10,
      impact: 5,
      complexity: 1,
      risk: 1,
      urgency: 1,
      priority: 5,
    };

    await memory.addMemory('SYSTEM#GLOBAL', category, content, metadata);
    return `Successfully saved knowledge as ${category}: ${content}`;
  },
};

/**
 * Pauses the current agent and requests clarification from the initiator.
 */
export const seekClarification = {
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
      await emitEvent(initiatorId || 'main.agent', EventType.CLARIFICATION_REQUEST, {
        userId,
        question,
        traceId,
        initiatorId,
        depth: (depth || 0) + 1,
        sessionId,
        originalTask: originalTask || task || 'Unknown task',
      });
      return `TASK_PAUSED: Clarification request sent to ${initiatorId || 'initiator'}. Waiting for response.`;
    } catch (error) {
      return `Failed to seek clarification: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Provides an answer to a clarification request, resuming the target agent.
 */
export const provideClarification = {
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
        depth: (depth || 0) + 1,
        initiatorId,
        isContinuation: true,
      });
      return `Clarification provided to ${agentId}. Continuation task emitted.`;
    } catch (error) {
      return `Failed to provide clarification: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
