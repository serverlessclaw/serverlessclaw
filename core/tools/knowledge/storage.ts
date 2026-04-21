import { knowledgeSchema as schema } from './schema';
import { DynamoMemory } from '../../lib/memory';
import { InsightCategory } from '../../lib/types/memory';
import { GapStatus, EventType } from '../../lib/types/agent';
import { emitEvent } from '../../lib/utils/bus';
import { formatErrorMessage } from '../../lib/utils/error';
import { normalizeTags } from '../../lib/memory/utils';
import { SkillRegistry } from '../../lib/skills';
import { logger } from '../../lib/logger';

/**
 * Lazy-load memory with instance reuse.
 */
let cachedMemory: DynamoMemory | undefined;

function getMemory(): DynamoMemory {
  if (!cachedMemory) {
    cachedMemory = new DynamoMemory();
  }
  return cachedMemory;
}

/**
 * Searches the project for matching skill definitions.
 */
export const discoverSkills = {
  ...schema.discoverSkills,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { query } = args as { query?: string };
    try {
      const skills = await SkillRegistry.findSkillsByKeyword(query ?? '');
      if (skills.length === 0) return 'No matching skills found.';

      return (
        `Found ${skills.length} matching skills:\n` +
        skills.map((s: any) => `- ${s.name}: ${s.description}`).join('\n')
      );
    } catch (error) {
      return `Failed to discover skills: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Installs a skill for a specific agent.
 */
export const installSkill = {
  ...schema.installSkill,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { skillName, agentId } = args as { skillName: string; agentId: string };
    try {
      await SkillRegistry.installSkill(skillName, agentId);
      return `Skill '${skillName}' successfully installed for agent ${agentId}`;
    } catch (error) {
      return `Failed to install skill: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Uninstalls a skill from a specific agent.
 */
export const uninstallSkill = {
  ...schema.uninstallSkill,
  requiredPermissions: ['config:update'],
  execute: async (
    args: Record<string, unknown>,
    context?: { userId?: string }
  ): Promise<string> => {
    const { skillName, agentId } = args as { skillName: string; agentId: string };

    // RBAC Check
    if (context?.userId) {
      const { BaseMemoryProvider } = await import('../../lib/memory/base');
      const { IdentityManager, UserRole } = await import('../../lib/session/identity');
      const identity = new IdentityManager(new BaseMemoryProvider());
      const user = await identity.getUser(context.userId);

      if (!user || (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN)) {
        logger.warn(`Unauthorized uninstallSkill attempt by ${context.userId} on ${agentId}`);
        return 'FAILED: Unauthorized. Only OWNER or ADMIN can uninstall skills.';
      }
    }

    try {
      const { ConfigManager } = await import('../../lib/registry/config');
      const toolsKey = `${agentId}_tools`;
      const currentTools = (await ConfigManager.getRawConfig(toolsKey)) as string[];

      if (!currentTools || !currentTools.includes(skillName)) {
        return `FAILED: Skill '${skillName}' is not installed for agent ${agentId}`;
      }

      const updatedTools = currentTools.filter((t) => t !== skillName);
      await ConfigManager.saveRawConfig(toolsKey, updatedTools);

      return `Successfully uninstalled skill '${skillName}' from agent ${agentId}`;
    } catch (error) {
      return `Failed to uninstall skill: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Recalls distilled knowledge and lessons from DynamoDB memory.
 */
export const recallKnowledge = {
  ...schema.recallKnowledge,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, _query, category, tags, _orgId, minImpact, minConfidence } = args as {
      userId: string;
      _query: string;
      category: InsightCategory;
      tags?: string[];
      _orgId?: string;
      minImpact?: number;
      minConfidence?: number;
    };
    const memory = getMemory();
    const _baseUserId = userId.startsWith('CONV#') ? userId.split('#')[1] : userId;

    const searchResponse = await memory.searchInsights({
      tags,
      category,
      limit: 50,
    });

    let results = searchResponse.items;

    // Apply filters post-discovery
    if (minImpact !== undefined) {
      results = results.filter((r) => (r.metadata.impact ?? 0) >= minImpact);
    }
    if (minConfidence !== undefined) {
      results = results.filter((r) => (r.metadata.confidence ?? 0) >= minConfidence);
    }

    if (results.length === 0) return 'No relevant knowledge found.';

    // Track hits asynchronously to not block the agent's tool return
    Promise.all(results.map((r) => memory.recordMemoryHit(r.id, r.timestamp))).catch((e) =>
      logger.warn('Failed to track memory hits:', e)
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
  ...schema.manageGap,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      gapId,
      status,
      action = 'update',
    } = args as {
      gapId?: string;
      status?: GapStatus;
      action?: 'update' | 'list';
    };

    try {
      const memory = getMemory();

      if (action === 'list') {
        const gaps = await memory.getAllGaps(GapStatus.OPEN);
        if (gaps.length === 0) return 'No open capability gaps found.';

        const sortedGaps = [...gaps].sort(
          (a, b) => (b.metadata.impact || 0) - (a.metadata.impact || 0)
        );

        return (
          `Found ${gaps.length} open capability gaps:\n` +
          sortedGaps
            .map(
              (g) =>
                `- [${g.id}] (Impact: ${g.metadata.impact}/10, Urgency: ${g.metadata.urgency}/10) ${g.content}`
            )
            .join('\n')
        );
      }

      if (!gapId || !status) {
        return 'FAILED: gapId and status are required for "update" action.';
      }

      await memory.updateGapStatus(gapId, status);
      return `Successfully updated gap ${gapId} to ${status}`;
    } catch (error) {
      return `Failed to ${action} gap: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Records a new capability gap or system limitation.
 */
export const reportGap = {
  ...schema.reportGap,
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
    } catch (error) {
      logger.error('Failed to report gap:', error);
      return `Failed to report gap: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Directly saves project knowledge (facts, insights, preferences) into the system memory.
 */
export const saveMemory = {
  ...schema.saveMemory,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { content, category, userId, tags, orgId } = args as {
      content: string;
      category: InsightCategory;
      userId: string;
      tags?: string[];
      orgId?: string;
    };

    const memory = getMemory();
    const baseUserId = userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
    const scopeId = category === 'user_preference' ? `USER#${baseUserId}` : 'SYSTEM#GLOBAL';

    // Autonomous Perspective Generation (Lightweight keyword extraction)
    const perspectiveKeywords = content
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4)
      .slice(0, 5);

    const metadata = {
      category,
      confidence: 10,
      impact: 5,
      complexity: 1,
      risk: 1,
      urgency: 1,
      priority: 5,
    };

    const finalTags = normalizeTags([...(tags ?? []), ...perspectiveKeywords]);

    await memory.addMemory(scopeId, category, content, {
      ...metadata,
      orgId,
      tags: finalTags,
    });
    return `Successfully saved knowledge as MEMORY:${category.toUpperCase()}${finalTags.length > 0 ? ` (Tags: ${finalTags.join(', ')})` : ''}: ${content}`;
  },
};

/**
 * Permanently deletes a specific memory item from the neural reserve.
 */
export const pruneMemory = {
  ...schema.pruneMemory,
  requiredPermissions: ['config:update'], // Mapping to existing Permission enum
  execute: async (
    args: Record<string, unknown>,
    context?: { userId?: string }
  ): Promise<string> => {
    const { partitionKey, timestamp } = args as { partitionKey: string; timestamp: number };
    if (!partitionKey || !timestamp) return 'FAILED: Both partitionKey and timestamp are required.';

    // 1.4 RBAC Check
    if (context?.userId) {
      const { BaseMemoryProvider } = await import('../../lib/memory/base');
      const { IdentityManager, UserRole } = await import('../../lib/session/identity');
      const identity = new IdentityManager(new BaseMemoryProvider());
      const user = await identity.getUser(context.userId);

      if (!user || (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN)) {
        logger.warn(`Unauthorized pruneMemory attempt by ${context.userId} on ${partitionKey}`);
        return 'FAILED: Unauthorized. Only OWNER or ADMIN can prune memory.';
      }
    }

    try {
      const memory = getMemory();
      await memory.deleteItem({ userId: partitionKey, timestamp });
      logger.info(`Memory pruned by ${context?.userId ?? 'system'}: ${partitionKey}@${timestamp}`);
      return `Successfully pruned memory item: ${partitionKey}@${timestamp}`;
    } catch (error) {
      return `Failed to prune memory item: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Adjusts priority, urgency, and impact scores of a memory item.
 */
export const prioritizeMemory = {
  ...schema.prioritizeMemory,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, timestamp, priority, urgency, impact } = args as {
      userId: string;
      timestamp: number;
      priority?: number;
      urgency?: number;
      impact?: number;
    };

    if (!userId || timestamp === undefined)
      return 'FAILED: Both userId and timestamp are required.';

    try {
      const memory = getMemory();
      const metadata: Record<string, number> = {};
      if (priority !== undefined) metadata.priority = priority;
      if (urgency !== undefined) metadata.urgency = urgency;
      if (impact !== undefined) metadata.impact = impact;

      if (Object.keys(metadata).length === 0) return 'FAILED: No update parameters provided.';

      await memory.updateInsightMetadata(userId, timestamp, metadata);
      return `Successfully updated memory ${userId}@${timestamp}`;
    } catch (error) {
      return `Failed to prioritize memory: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Deletes execution traces.
 */
export const deleteTraces = {
  ...schema.deleteTraces,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { traceId } = args as { traceId: string };
    if (!traceId) return 'FAILED: traceId is required.';

    try {
      const sst = await import('sst');
      const { Resource } = sst;
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand, QueryCommand } =
        await import('@aws-sdk/lib-dynamodb');

      const tableName = (Resource as unknown as Record<string, { name?: string }>).TraceTable?.name;
      if (!tableName) return 'FAILED: TraceTable not linked.';

      const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

      if (traceId === 'all') {
        const MAX_DELETE_LIMIT = 500;
        let deletedCount = 0;
        let lastKey: Record<string, unknown> | undefined;
        do {
          if (deletedCount >= MAX_DELETE_LIMIT) {
            logger.warn('deleteTraces: Hit maximum delete limit', { limit: MAX_DELETE_LIMIT });
            break;
          }
          const scanRes = await docClient.send(
            new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey, Limit: 50 })
          );
          if (scanRes.Items && scanRes.Items.length > 0) {
            for (let i = 0; i < scanRes.Items.length; i += 25) {
              if (deletedCount >= MAX_DELETE_LIMIT) break;
              const batch = scanRes.Items.slice(i, i + 25);
              await docClient.send(
                new BatchWriteCommand({
                  RequestItems: {
                    [tableName]: batch.map((item) => ({
                      DeleteRequest: { Key: { traceId: item.traceId, nodeId: item.nodeId } },
                    })),
                  },
                })
              );
              deletedCount += batch.length;
            }
          }
          lastKey = scanRes.LastEvaluatedKey;
        } while (lastKey && deletedCount < MAX_DELETE_LIMIT);
        return `Successfully purged traces. ${deletedCount} nodes deleted (limit: ${MAX_DELETE_LIMIT}).`;
      }

      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'traceId = :tid',
          ExpressionAttributeValues: { ':tid': traceId },
          ProjectionExpression: 'traceId, nodeId',
        })
      );

      if (!Items || Items.length === 0) return `No trace nodes found for ${traceId}`;

      for (let i = 0; i < Items.length; i += 25) {
        const batch = Items.slice(i, i + 25);
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [tableName]: batch.map((item) => ({
                DeleteRequest: { Key: { traceId: item.traceId, nodeId: item.nodeId } },
              })),
            },
          })
        );
      }
      return `Successfully deleted trace ${traceId}.`;
    } catch (error) {
      return `Failed to delete traces: ${formatErrorMessage(error)}`;
    }
  },
};
/**
 * Force-releases a distributed lock by deleting it from memory.
 */
export const forceReleaseLock = {
  ...schema.forceReleaseLock,
  requiredPermissions: ['config:update'], // Mapping to existing Permission enum
  execute: async (
    args: Record<string, unknown>,
    context?: { userId?: string }
  ): Promise<string> => {
    const { lockId } = args as { lockId: string };
    if (!lockId) return 'FAILED: lockId is required.';

    // 1.3 Validate lock type & 1.4 RBAC Check
    if (!lockId.startsWith('LOCK#')) {
      return `FAILED: Invalid lockId format. Must start with 'LOCK#'.`;
    }

    if (context?.userId) {
      const { BaseMemoryProvider } = await import('../../lib/memory/base');
      const { IdentityManager, UserRole } = await import('../../lib/session/identity');
      const identity = new IdentityManager(new BaseMemoryProvider());
      const user = await identity.getUser(context.userId);

      if (!user || (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN)) {
        logger.warn(`Unauthorized forceReleaseLock attempt by ${context.userId} on ${lockId}`);
        return 'FAILED: Unauthorized. Only OWNER or ADMIN can force release locks.';
      }
    }

    try {
      // 1.3 Condition check for type safety
      await getMemory().deleteItem({
        userId: lockId,
        timestamp: 0,
        ConditionExpression: '#type = :lockType',
        ExpressionAttributeNames: { '#type': 'type' },
        ExpressionAttributeValues: { ':lockType': 'LOCK' },
      });
      logger.info(`Lock force-released by ${context?.userId ?? 'system'}: ${lockId}`);
      return `Successfully force-released lock: ${lockId}`;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return `FAILED: Item ${lockId} is not a valid lock or has already been released.`;
      }
      return `Failed to release lock: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Updates or corrects an existing memory item.
 */
export const refineMemory = {
  ...schema.refineMemory,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, timestamp, content, tags, priority } = args as {
      userId: string;
      timestamp: number;
      content?: string;
      tags?: string[];
      priority?: number;
    };

    if (!userId || !timestamp) return 'FAILED: userId and timestamp are required.';

    try {
      const memory = getMemory();
      await memory.refineMemory(userId, timestamp, content, {
        tags,
        priority,
      });
      return `Successfully refined memory item: ${userId}@${timestamp}`;
    } catch (error) {
      return `Failed to refine memory: ${formatErrorMessage(error)}`;
    }
  },
};
