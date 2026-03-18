import { toolDefinitions } from './definitions';
import { DynamoMemory } from '../lib/memory';
import { InsightCategory, GapStatus, EventType } from '../lib/types/index';
import { emitEvent } from '../lib/utils/bus';
import { formatErrorMessage } from '../lib/utils/error';

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
--- NODE: ${n.nodeId} (Parent: ${n.parentId ?? 'None'}) ---
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
      return `Failed to inspect trace: ${formatErrorMessage(error)}`;
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
      return `Failed to discover skills: ${formatErrorMessage(error)}`;
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
    const targetAgentId = agentId ?? 'main';

    try {
      const { SkillRegistry } = await import('../lib/skills');
      await SkillRegistry.installSkill(targetAgentId, skillName);
      return `Skill '${skillName}' successfully installed for agent ${targetAgentId}.`;
    } catch (error) {
      return `Failed to install skill: ${formatErrorMessage(error)}`;
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
    const targetAgentId = agentId ?? 'main';

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
      return `Failed to uninstall skill: ${formatErrorMessage(error)}`;
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
    const memory = getMemory();
    const results = await memory.searchInsights(userId, query, category as InsightCategory);

    if (results.length === 0) return 'No relevant knowledge found.';

    // Track hits asynchronously to not block the agent's tool return
    Promise.all(results.map((r) => memory.recordMemoryHit(r.id, r.timestamp))).catch((e) =>
      console.warn('Failed to track memory hits:', e)
    );

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
      return `Failed to update gap ${gapId}: ${formatErrorMessage(error)}`;
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
        category: category ?? InsightCategory.STRATEGIC_GAP,
        confidence: 9,
        impact: impact ?? 5,
        complexity: 5,
        risk: 5,
        urgency: urgency ?? 5,
        priority: 5,
      };

      const gapIdTimestamp = await getMemory().addMemory(
        'SYSTEM#GLOBAL',
        category ?? InsightCategory.STRATEGIC_GAP,
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
 * Directly saves project knowledge (facts, insights, preferences) into the system memory.
 * Implements semantic deduplication to prevent redundant or conflicting entries.
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
    const baseUserId = userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
    const scopeId = category === 'user_preference' ? `USER#${baseUserId}` : 'SYSTEM#GLOBAL';

    // --- Start Semantic Deduplication ---
    try {
      // 1. Search for existing memories in the same category and scope
      const existing = await memory.searchInsights(baseUserId, '*', category as InsightCategory);

      // 2. Filter for the exact same scope to avoid pruning global knowledge from a user context
      const relevantExisting = existing.filter((e) => e.id === scopeId);

      if (relevantExisting.length > 0) {
        const newKeywords = content
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 3);

        for (const oldMem of relevantExisting) {
          const oldKeywords = oldMem.content
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 3);

          // Simple Jaccard-ish similarity check for high-confidence conflicts
          const intersection = newKeywords.filter((w) => oldKeywords.includes(w));
          const similarity = intersection.length / Math.max(newKeywords.length, oldKeywords.length);

          // If > 60% similarity, assume it's an update/redundancy and prune the old one
          if (similarity > 0.6) {
            console.log(
              `[Deduplication] Pruning similar memory: "${oldMem.content}" (Similarity: ${Math.round(similarity * 100)}%)`
            );
            await memory.deleteItem({ userId: scopeId, timestamp: oldMem.timestamp });
          }
        }
      }
    } catch (error) {
      console.warn('Deduplication check failed, proceeding with standard save:', error);
    }
    // --- End Semantic Deduplication ---

    const metadata = {
      category: category as InsightCategory,
      confidence: 10,
      impact: 5,
      complexity: 1,
      risk: 1,
      urgency: 1,
      priority: 5,
    };

    // All knowledge is now stored via addMemory which uses the unified MEMORY: prefix
    await memory.addMemory(scopeId, category, content, metadata);
    return `Successfully saved knowledge as MEMORY:${category.toUpperCase()}: ${content}`;
  },
};

/**
 * Permanently deletes a specific memory item from the neural reserve.
 */
export const pruneMemory = {
  ...toolDefinitions.pruneMemory,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { partitionKey, timestamp } = args as { partitionKey: string; timestamp: number };

    if (!partitionKey || !timestamp) {
      return 'FAILED: Both partitionKey and timestamp are required to prune memory.';
    }

    try {
      const memory = getMemory();
      await memory.deleteItem({ userId: partitionKey, timestamp });
      return `Successfully pruned memory item: ${partitionKey}@${timestamp}`;
    } catch (error) {
      return `Failed to prune memory item: ${formatErrorMessage(error)}`;
    }
  },
};
