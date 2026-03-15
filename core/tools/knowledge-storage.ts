import { toolDefinitions } from './definitions';
import { DynamoMemory } from '../lib/memory';
import { InsightCategory, GapStatus, EventType } from '../lib/types/index';
import { emitEvent } from '../lib/utils/bus';

/**
 * Lazy-load memory.
 */
function getMemory() {
  return new DynamoMemory();
}

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
      const { ConfigManager } = await import('../lib/registry/config');
      await ConfigManager.saveRawConfig(`${targetAgentId}_tools`, updatedTools);

      return `Successfully uninstalled skill '${skillName}' from agent ${targetAgentId}.`;
    } catch (error) {
      return `Failed to uninstall skill: ${error instanceof Error ? error.message : String(error)}`;
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
 * Directly saves a new fact or user preference into the system memory.
 */
export const saveMemory = {
  ...toolDefinitions.saveMemory,
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
