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

const COLLAB_PREFIX = 'COLLAB#';
const COLLAB_INDEX_PREFIX = 'COLLAB_INDEX#';

/**
 * Creates a new collaboration with a shared session
 *
 * @param base - The base memory provider.
 * @param ownerId - The ID of the collaboration owner.
 * @param ownerType - The type of the owner (human or agent).
 * @param input - The collaboration creation parameters.
 */
export async function createCollaboration(
  base: BaseMemoryProvider,
  ownerId: string,
  ownerType: ParticipantType,
  input: CreateCollaborationInput
): Promise<Collaboration> {
  const collaborationId = uuidv4();
  const sessionId = input.sessionId ?? uuidv4();
  const now = Date.now();
  const workspaceId = input.workspaceId;

  const participants: CollaborationParticipant[] = [
    { type: ownerType, id: ownerId, role: 'owner', joinedAt: now },
  ];

  if (input.initialParticipants) {
    for (const p of input.initialParticipants) {
      if (p.id !== ownerId) {
        participants.push({
          type: p.type,
          id: p.id,
          role: p.role,
          joinedAt: now,
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

  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, workspaceId);
  await base.putItem({
    userId: pk,
    timestamp: 0,
    type: 'COLLABORATION',
    ...collaboration,
  });

  // Index for each participant
  for (const participant of participants) {
    const indexPk = base.getScopedUserId(
      `${COLLAB_INDEX_PREFIX}${participant.type}#${participant.id}`,
      workspaceId
    );
    await base.putItem({
      userId: indexPk,
      timestamp: now,
      type: 'COLLABORATION_INDEX',
      collaborationId,
      role: participant.role,
      collaborationName: input.name,
      status: 'active',
      workspaceId,
    });
  }

  logger.info(
    `Collaboration created: ${collaborationId} by ${ownerType}:${ownerId} in workspace: ${workspaceId}`
  );
  return collaboration;
}

/**
 * Adds a participant to a collaboration
 *
 * @param base - The base memory provider.
 * @param collaborationId - The ID of the collaboration.
 * @param actorId - The ID of the member adding the participant (must be owner).
 * @param actorType - The type of the actor.
 * @param newParticipant - The new participant details including type, id, and role.
 * @param workspaceId - Optional workspace identifier for isolation.
 */
export async function addCollaborationParticipant(
  base: BaseMemoryProvider,
  collaborationId: string,
  actorId: string,
  actorType: ParticipantType,
  newParticipant: { type: ParticipantType; id: string; role: CollaborationRole },
  workspaceId?: string
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId, workspaceId);
  if (!collaboration) {
    throw new Error(`Collaboration ${collaborationId} not found`);
  }

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

  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, workspaceId);

  // Update collaboration metadata atomically (Principle 13)
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

  // Add index entry for new participant
  const indexPk = base.getScopedUserId(
    `${COLLAB_INDEX_PREFIX}${newParticipant.type}#${newParticipant.id}`,
    workspaceId
  );
  await base.putItem({
    userId: indexPk,
    timestamp: now,
    type: 'COLLABORATION_INDEX',
    collaborationId,
    role: newParticipant.role,
    collaborationName: collaboration.name,
    status: 'active',
    workspaceId,
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
  workspaceId?: string
): Promise<Collaboration | null> {
  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, workspaceId);
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
 *
 * @param base - The base memory provider.
 * @param participantId - The ID of the participant to list collaborations for.
 * @param participantType - The type of the participant (human or agent).
 * @param workspaceId - Optional workspace identifier for isolation.
 */
export async function listCollaborationsForParticipant(
  base: BaseMemoryProvider,
  participantId: string,
  participantType: ParticipantType,
  workspaceId?: string
): Promise<Array<{ collaborationId: string; role: CollaborationRole; collaborationName: string }>> {
  const pk = base.getScopedUserId(
    `${COLLAB_INDEX_PREFIX}${participantType}#${participantId}`,
    workspaceId
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
 *
 * @param base - The base memory provider.
 * @param collaborationId - The ID of the collaboration.
 * @param participantId - The ID of the participant.
 * @param participantType - The type of the participant.
 * @param requiredRole - Optional minimum role required for access.
 * @param workspaceId - Optional workspace identifier for isolation.
 */
export async function checkCollaborationAccess(
  base: BaseMemoryProvider,
  collaborationId: string,
  participantId: string,
  participantType: ParticipantType,
  requiredRole?: CollaborationRole,
  workspaceId?: string
): Promise<boolean> {
  const collaboration = await getCollaboration(base, collaborationId, workspaceId);
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
  workspaceId?: string
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId, workspaceId);
  if (!collaboration) {
    throw new Error(`Collaboration ${collaborationId} not found`);
  }

  const actor = collaboration.participants.find((p) => p.id === actorId && p.type === actorType);
  if (!actor || actor.role !== 'owner') {
    throw new Error('Only owners can close collaborations');
  }

  const now = Date.now();
  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, workspaceId);

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
        workspaceId
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
 * Updates the last activity timestamp for a collaboration
 */
export async function updateCollaborationActivity(
  base: BaseMemoryProvider,
  collaborationId: string,
  workspaceId?: string
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId, workspaceId);
  if (!collaboration) return;

  collaboration.lastActivityAt = Date.now();
  collaboration.updatedAt = Date.now();

  const pk = base.getScopedUserId(`${COLLAB_PREFIX}${collaborationId}`, workspaceId);
  await base.putItem({
    userId: pk,
    timestamp: 0,
    type: 'COLLABORATION',
    ...collaboration,
  });
}

/**
 * Finds collaborations that have timed out based on their custom timeoutMs.
 * If no custom timeout is set, it uses the system default TIE_BREAK_TIMEOUT_MS.
 */
export async function findStaleCollaborations(
  base: BaseMemoryProvider,
  defaultTimeoutMs: number,
  workspaceId?: string
): Promise<Collaboration[]> {
  const now = Date.now();

  const params: any = {
    FilterExpression: workspaceId
      ? '#status = :active AND workspaceId = :workspaceId'
      : '#status = :active',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':active': 'active',
      ...(workspaceId ? { ':workspaceId': workspaceId } : {}),
    },
  };

  const allActive = await base.queryItems(params);

  return (allActive as unknown as Collaboration[]).filter((c) => {
    const timeout = c.timeoutMs || defaultTimeoutMs;
    return now - c.lastActivityAt > timeout;
  });
}
