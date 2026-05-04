/**
 * Collaboration Operations for DynamoDB
 * Handles multi-party collaboration via shared sessions
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import type { BaseMemoryProvider } from './base';
import { RetentionManager } from './tiering';
import {
  Collaboration,
  CollaborationParticipant,
  CreateCollaborationInput,
  CollaborationRole,
  ParticipantType,
  getSyntheticUserId,
} from '../types/collaboration';
import { MessageRole } from '../types/llm';
import { ContextualScope } from '../types/memory';
import { resolveScopeId } from './utils';
const COLLAB_PREFIX = 'COLLAB#';
const COLLAB_INDEX_PREFIX = 'COLLAB_INDEX#';

/**
 * Creates a new collaboration with a shared session
 */
export async function createCollaboration(
  base: BaseMemoryProvider,
  ownerId: string,
  ownerType: ParticipantType,
  input: CreateCollaborationInput,
  scope?: string | ContextualScope
): Promise<Collaboration> {
  const collaborationId = uuidv4();
  const sessionId = input.sessionId ?? uuidv4();
  const now = Date.now();
  const workspaceId = (typeof scope === 'string' ? scope : scope?.workspaceId) ?? input.workspaceId;

  const participants: CollaborationParticipant[] = [
    { type: ownerType, id: ownerId, role: 'owner', joinedAt: now },
  ];

  if (input.initialParticipants) {
    const { AgentRegistry } = await import('../registry');
    let pIdx = 1;
    for (const p of input.initialParticipants) {
      if (p.id !== ownerId) {
        // Sh10: Verify agent is enabled before adding (Principle 14)
        if (p.type === 'agent') {
          const agentConfig = await AgentRegistry.getAgentConfig(p.id, { workspaceId });
          if (!agentConfig || agentConfig.enabled !== true) {
            throw new Error(`Agent ${p.id} is disabled and cannot be invited to collaboration.`);
          }
        }

        participants.push({
          type: p.type,
          id: p.id,
          role: p.role,
          joinedAt: now + pIdx++, // Ensure uniqueness within this collab
        });
      }
    }
  }

  const syntheticUserId = getSyntheticUserId(collaborationId);

  // Standardize expiresAt to seconds (Unix timestamp)
  const { expiresAt: ttlExpiresAt } = await RetentionManager.getExpiresAt(
    'SESSIONS',
    collaborationId
  );
  const finalExpiresAt = input.ttlDays
    ? Math.floor((now + input.ttlDays * 24 * 60 * 60 * 1000) / 1000)
    : ttlExpiresAt;

  const collaboration: Collaboration = {
    collaborationId,
    name: input.name,
    description: input.description,
    sessionId,
    syntheticUserId,
    owner: { type: ownerType, id: ownerId },
    participants,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: finalExpiresAt,
    timeoutMs: input.timeoutMs,
    status: 'active',
    tags: input.tags,
    workspaceId,
  };

  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, scope || workspaceId);
  await base.putItem(
    {
      userId: pk,
      timestamp: 0,
      type: 'COLLABORATION',
      ...collaboration,
    },
    {
      ConditionExpression: 'attribute_not_exists(userId)',
    }
  );

  // Index for each participant
  let syncRequired = false;
  for (const participant of participants) {
    const indexPk = base.getScopedUserId(
      `${COLLAB_INDEX_PREFIX}${participant.type}#${participant.id}`,
      scope || workspaceId
    );

    // Sh12: Prevent millisecond collision overwrites via retry and jitter
    let attempt = 0;
    let success = false;
    while (attempt < 5 && !success) {
      try {
        await base.putItem(
          {
            userId: indexPk,
            timestamp: participant.joinedAt + attempt,
            type: 'COLLABORATION_INDEX',
            collaborationId,
            role: participant.role,
            collaborationName: input.name,
            status: 'active',
            workspaceId,
          },
          {
            ConditionExpression: 'attribute_not_exists(userId)',
          }
        );
        // Sync the actual used timestamp back to participant for cleanup
        if (attempt > 0) {
          participant.joinedAt += attempt;
          syncRequired = true;
        }
        success = true;
      } catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException') {
          attempt++;
        } else {
          throw e;
        }
      }
    }
    if (!success) {
      logger.warn(`Failed to index participant ${participant.id} after 5 attempts`);
    }
  }

  // If any participant timestamp drifted due to millisecond collision, sync the main record
  if (syncRequired) {
    await base.updateItem({
      TableName: base['tableName'] || 'MemoryTable',
      Key: { userId: pk, timestamp: 0 },
      UpdateExpression: 'SET participants = :p',
      ExpressionAttributeValues: { ':p': participants },
    });
  }

  logger.info(
    `Collaboration created: ${collaborationId} by ${ownerType}:${ownerId} in workspace: ${workspaceId}`
  );
  return collaboration;
}

/**
 * Adds a participant to a collaboration
 */
export async function addCollaborationParticipant(
  base: BaseMemoryProvider,
  collaborationId: string,
  actorId: string,
  actorType: ParticipantType,
  newParticipant: { type: ParticipantType; id: string; role: CollaborationRole },
  scope?: string | ContextualScope
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId, scope);
  if (!collaboration) {
    throw new Error(`Collaboration ${collaborationId} not found`);
  }

  const workspaceId =
    (typeof scope === 'string' ? scope : scope?.workspaceId) ?? collaboration.workspaceId;

  // Check if actor is owner
  const actor = collaboration.participants.find((p) => p.id === actorId && p.type === actorType);
  if (!actor || actor.role !== 'owner') {
    throw new Error('Only owners can add participants');
  }

  const now = Date.now();

  const participant: CollaborationParticipant = {
    type: newParticipant.type,
    id: newParticipant.id,
    role: newParticipant.role,
    joinedAt: now,
  };

  // Sh10: Verify agent is enabled before adding (Principle 14)
  if (newParticipant.type === 'agent') {
    const { AgentRegistry } = await import('../registry');
    const agentConfig = await AgentRegistry.getAgentConfig(newParticipant.id, {
      workspaceId,
    });
    if (!agentConfig || agentConfig.enabled !== true) {
      throw new Error(`Agent ${newParticipant.id} is disabled and cannot be invited.`);
    }
  }

  // Add index entry for new participant (Sh12: Millisecond Collision Protection)
  let attempt = 0;
  let success = false;
  const indexPk = base.getScopedUserId(
    `${COLLAB_INDEX_PREFIX}${newParticipant.type}#${newParticipant.id}`,
    scope
  );

  while (attempt < 5 && !success) {
    try {
      await base.putItem(
        {
          userId: indexPk,
          timestamp: participant.joinedAt + attempt,
          type: 'COLLABORATION_INDEX',
          collaborationId,
          role: newParticipant.role,
          collaborationName: collaboration.name,
          status: 'active',
          workspaceId,
        },
        {
          ConditionExpression: 'attribute_not_exists(userId)',
        }
      );
      participant.joinedAt += attempt; // Sync for storage in collaboration record
      success = true;
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') {
        attempt++;
      } else {
        throw e;
      }
    }
  }

  // Update collaboration metadata atomically (Principle 13)
  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, scope || workspaceId);
  await base.updateItem({
    Key: {
      userId: pk,
      timestamp: 0,
    },
    UpdateExpression:
      'SET participants = list_append(participants, :newParticipant), updatedAt = :now, lastActivityAt = :now',
    ConditionExpression: 'attribute_exists(userId)',
    ExpressionAttributeValues: {
      ':newParticipant': [participant],
      ':now': now,
    },
  });

  logger.info(
    `Participant ${newParticipant.type}:${newParticipant.id} added to collaboration ${collaborationId} in workspace ${workspaceId}`
  );
}

/**
 * Gets a collaboration by ID
 */
export async function getCollaboration(
  base: BaseMemoryProvider,
  collaborationId: string,
  scope?: string | ContextualScope
): Promise<Collaboration | null> {
  const workspaceId = resolveScopeId(scope);
  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, scope || workspaceId);
  const result = await base.queryItems({
    KeyConditionExpression: 'userId = :userId AND #timestamp = :zero',
    ExpressionAttributeNames: { '#timestamp': 'timestamp' },
    ExpressionAttributeValues: {
      ':userId': pk,
      ':zero': 0,
    },
  });

  if (result.length === 0) return null;
  return result[0] as unknown as Collaboration;
}

/**
 * Lists collaborations for a participant
 */
export async function listCollaborationsForParticipant(
  base: BaseMemoryProvider,
  participantId: string,
  participantType: ParticipantType,
  scope?: string | ContextualScope
): Promise<Array<{ collaborationId: string; role: CollaborationRole; collaborationName: string }>> {
  const pk = base.getScopedUserId(
    `${COLLAB_INDEX_PREFIX}${participantType}#${participantId}`,
    scope
  );
  const result = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': pk,
    },
  });

  return result.map((item) => ({
    collaborationId: item.collaborationId as string,
    role: item.role as CollaborationRole,
    collaborationName: item.collaborationName as string,
  }));
}

/**
 * Checks if a participant has access to a collaboration
 */
export async function checkCollaborationAccess(
  base: BaseMemoryProvider,
  collaborationId: string,
  participantId: string,
  participantType: ParticipantType,
  requiredRole?: CollaborationRole,
  scope?: string | ContextualScope
): Promise<boolean> {
  const collaboration = await getCollaboration(base, collaborationId, scope);
  if (!collaboration) return false;

  const participant = collaboration.participants.find(
    (p) => p.id === participantId && p.type === participantType
  );

  if (!participant) return false;
  if (collaboration.status !== 'active') return false;

  if (requiredRole) {
    if (requiredRole === 'owner' && participant.role !== 'owner') return false;
    if (requiredRole === 'editor' && participant.role === 'viewer') return false;
  }

  return true;
}

/**
 * Closes a collaboration
 */
export async function closeCollaboration(
  base: BaseMemoryProvider,
  collaborationId: string,
  actorId: string,
  actorType: ParticipantType,
  scope?: string | ContextualScope
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId, scope);
  if (!collaboration) {
    throw new Error(`Collaboration ${collaborationId} not found`);
  }

  const workspaceId =
    (typeof scope === 'string' ? scope : scope?.workspaceId) ?? collaboration.workspaceId;

  const actor = collaboration.participants.find((p) => p.id === actorId && p.type === actorType);
  if (!actor || actor.role !== 'owner') {
    throw new Error('Only owners can close collaborations');
  }

  const now = Date.now();
  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, scope || workspaceId);

  // Atomic update status (Principle 13)
  await base.updateItem({
    Key: {
      userId: pk,
      timestamp: 0,
    },
    UpdateExpression: 'SET #status = :closed, updatedAt = :now, lastActivityAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':closed': 'closed',
      ':now': now,
    },
  });

  // Clean up ALL participant index entries to prevent orphaned records
  const allParticipants = collaboration.participants;
  for (const participant of allParticipants) {
    try {
      const indexPk = base.getScopedUserId(
        `${COLLAB_INDEX_PREFIX}${participant.type}#${participant.id}`,
        scope
      );
      // Use the participant's joinedAt timestamp as the sort key
      await base.deleteItem({
        userId: indexPk,
        timestamp: participant.joinedAt,
      });
    } catch (error) {
      logger.warn(`Failed to delete index entry for ${participant.type}:${participant.id}:`, error);
    }
  }

  logger.info(
    `Collaboration ${collaborationId} closed by ${actorType}:${actorId} in workspace ${workspaceId}`
  );
}

/**
 * Updates the last activity timestamp for a collaboration atomically (Principle 13)
 */
export async function updateCollaborationActivity(
  base: BaseMemoryProvider,
  collaborationId: string,
  scope?: string | ContextualScope
): Promise<void> {
  const workspaceId = resolveScopeId(scope);
  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, scope || workspaceId);
  const now = Date.now();

  try {
    await base.updateItem({
      Key: {
        userId: pk,
        timestamp: 0,
      },
      UpdateExpression: 'SET lastActivityAt = :now, updatedAt = :now',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: {
        ':now': now,
      },
    });
  } catch (e) {
    if ((e as Error).name !== 'ConditionalCheckFailedException') {
      logger.warn(`Failed to update collaboration activity for ${collaborationId}:`, e);
    }
  }
}

/**
 * Finds collaborations that have timed out based on their custom timeoutMs.
 */
export async function findStaleCollaborations(
  base: BaseMemoryProvider,
  defaultTimeoutMs: number,
  scope?: string | ContextualScope
): Promise<Collaboration[]> {
  const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
  const now = Date.now();

  const params: Record<string, unknown> = {
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#type = :type',
    FilterExpression: workspaceId
      ? '#status = :active AND workspaceId = :workspaceId'
      : '#status = :active',
    ExpressionAttributeNames: { '#status': 'status', '#type': 'type' },
    ExpressionAttributeValues: {
      ':active': 'active',
      ':type': 'COLLABORATION',
      ...(workspaceId ? { ':workspaceId': workspaceId } : {}),
    },
  };

  const allActive = await base.queryItems(params);

  return (allActive as unknown as Collaboration[]).filter((c) => {
    const timeout = c.timeoutMs || defaultTimeoutMs;
    return now - c.lastActivityAt > timeout;
  });
}

/**
 * Transits a 1:1 session into a collaboration session
 */
export async function transitToCollaboration(
  base: BaseMemoryProvider,
  userId: string,
  scope: string | ContextualScope,
  sourceSessionId: string,
  invitedAgentIds: string[],
  name?: string
): Promise<Collaboration> {
  const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
  const collaboration = await createCollaboration(
    base,
    userId,
    'human',
    {
      name: name || `Collaboration: ${sourceSessionId.substring(0, 8)}`,
      description: `Transited from session ${sourceSessionId}`,
      workspaceId,
      initialParticipants: [
        ...invitedAgentIds.map((id) => ({
          id,
          type: 'agent' as ParticipantType,
          role: 'editor' as CollaborationRole,
        })),
        {
          id: 'facilitator',
          type: 'agent' as ParticipantType,
          role: 'editor' as CollaborationRole,
        },
      ],
      tags: [`source_session:${sourceSessionId}`],
    },
    scope
  );

  // Seed history
  try {
    const history = await base.getHistory(
      base.getScopedUserId(`CONV#${userId}#${sourceSessionId}`, scope)
    );
    if (history && history.length > 0) {
      const recent = history.slice(-5);
      const summary = recent.map((m) => `${m.role}: ${m.content}`).join('\n\n');
      const syntheticId = getSyntheticUserId(collaboration.collaborationId);

      await base.putItem({
        userId: base.getScopedUserId(syntheticId, scope),
        timestamp: Date.now(),
        type: 'MESSAGE',
        role: MessageRole.SYSTEM,
        content: `### Context Transition ###\n\nThis collaboration has been transited from a 1:1 session. Brief history summary:\n\n${summary}`,
        metadata: { type: 'context_transition' },
        traceId: `transit-${collaboration.collaborationId}`,
      });
    }
  } catch (e) {
    logger.warn(`Failed to seed history for collab ${collaboration.collaborationId}:`, e);
  }

  return collaboration;
}
