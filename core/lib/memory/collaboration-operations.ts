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
    expiresAt: input.ttlDays ? now + input.ttlDays * 24 * 60 * 60 * 1000 : undefined,
    timeoutMs: input.timeoutMs,
    status: 'active',
    tags: input.tags,
    workspaceId: input.workspaceId,
  };

  // Store collaboration metadata
  const { expiresAt: ttlExpiresAt, type: _type } = await RetentionManager.getExpiresAt(
    'SESSIONS',
    collaborationId
  );
  await base.putItem({
    userId: `${COLLAB_PREFIX}${collaborationId}`,
    timestamp: 0,
    type: 'COLLABORATION',
    expiresAt: collaboration.expiresAt ? Math.floor(collaboration.expiresAt / 1000) : ttlExpiresAt,
    ...collaboration,
  });

  // Index for each participant
  for (const participant of participants) {
    await base.putItem({
      userId: `${COLLAB_INDEX_PREFIX}${participant.type}#${participant.id}`,
      timestamp: now,
      type: 'COLLABORATION_INDEX',
      collaborationId,
      role: participant.role,
      collaborationName: input.name,
      status: 'active',
    });
  }

  logger.info(`Collaboration created: ${collaborationId} by ${ownerType}:${ownerId}`);
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
 */
export async function addCollaborationParticipant(
  base: BaseMemoryProvider,
  collaborationId: string,
  actorId: string,
  actorType: ParticipantType,
  newParticipant: { type: ParticipantType; id: string; role: CollaborationRole }
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId);
  if (!collaboration) {
    throw new Error(`Collaboration ${collaborationId} not found`);
  }

  // Check if actor is owner
  const actor = collaboration.participants.find((p) => p.id === actorId && p.type === actorType);
  if (!actor || actor.role !== 'owner') {
    throw new Error('Only owners can add participants');
  }

  const now = Date.now();

  // Add to collaboration
  collaboration.participants.push({
    type: newParticipant.type,
    id: newParticipant.id,
    role: newParticipant.role,
    joinedAt: now,
  });
  collaboration.updatedAt = now;
  collaboration.lastActivityAt = now;

  // Update collaboration
  await base.putItem({
    userId: `${COLLAB_PREFIX}${collaborationId}`,
    timestamp: 0,
    type: 'COLLABORATION',
    ...collaboration,
  });

  // Add index entry for new participant
  await base.putItem({
    userId: `${COLLAB_INDEX_PREFIX}${newParticipant.type}#${newParticipant.id}`,
    timestamp: now,
    type: 'COLLABORATION_INDEX',
    collaborationId,
    role: newParticipant.role,
    collaborationName: collaboration.name,
    status: 'active',
  });

  logger.info(
    `Participant ${newParticipant.type}:${newParticipant.id} added to collaboration ${collaborationId}`
  );
}

/**
 * Gets a collaboration by ID
 */
export async function getCollaboration(
  base: BaseMemoryProvider,
  collaborationId: string
): Promise<Collaboration | null> {
  const result = await base.queryItems({
    KeyConditionExpression: 'userId = :userId AND #timestamp = :zero',
    ExpressionAttributeNames: { '#timestamp': 'timestamp' },
    ExpressionAttributeValues: {
      ':userId': `${COLLAB_PREFIX}${collaborationId}`,
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
 */
export async function listCollaborationsForParticipant(
  base: BaseMemoryProvider,
  participantId: string,
  participantType: ParticipantType
): Promise<Array<{ collaborationId: string; role: CollaborationRole; collaborationName: string }>> {
  const result = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': `${COLLAB_INDEX_PREFIX}${participantType}#${participantId}`,
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
 */
export async function checkCollaborationAccess(
  base: BaseMemoryProvider,
  collaborationId: string,
  participantId: string,
  participantType: ParticipantType,
  requiredRole?: CollaborationRole
): Promise<boolean> {
  const collaboration = await getCollaboration(base, collaborationId);
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
  actorType: ParticipantType
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId);
  if (!collaboration) {
    throw new Error(`Collaboration ${collaborationId} not found`);
  }

  const actor = collaboration.participants.find((p) => p.id === actorId && p.type === actorType);
  if (!actor || actor.role !== 'owner') {
    throw new Error('Only owners can close collaborations');
  }

  collaboration.status = 'closed';
  collaboration.updatedAt = Date.now();
  collaboration.lastActivityAt = Date.now();

  await base.putItem({
    userId: `${COLLAB_PREFIX}${collaborationId}`,
    timestamp: 0,
    type: 'COLLABORATION',
    ...collaboration,
  });

  // Clean up ALL participant index entries to prevent orphaned records
  // Need to fetch all participants including those added after creation
  const allParticipants = collaboration.participants;
  for (const participant of allParticipants) {
    try {
      // Use the participant's joinedAt timestamp as the sort key
      await base.deleteItem({
        userId: `${COLLAB_INDEX_PREFIX}${participant.type}#${participant.id}`,
        timestamp: participant.joinedAt,
      });
    } catch (error) {
      logger.warn(`Failed to delete index entry for ${participant.type}:${participant.id}:`, error);
    }
  }

  logger.info(`Collaboration ${collaborationId} closed by ${actorType}:${actorId}`);
}

/**
 * Updates the last activity timestamp for a collaboration
 */
export async function updateCollaborationActivity(
  base: BaseMemoryProvider,
  collaborationId: string
): Promise<void> {
  const collaboration = await getCollaboration(base, collaborationId);
  if (!collaboration) return;

  collaboration.lastActivityAt = Date.now();
  collaboration.updatedAt = Date.now();

  await base.putItem({
    userId: `${COLLAB_PREFIX}${collaborationId}`,
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
  defaultTimeoutMs: number
): Promise<Collaboration[]> {
  const now = Date.now();

  // Note: For a production scale, we would use a GSI with lastActivityAt.
  // For this sandbox implementaiton, we'll scan (limited to active collaborations prefix).
  // In a real AWS setup, you'd use a scheduled Lambda + GSI query.
  const allActive = await base.queryItems({
    FilterExpression: '#status = :active',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':active': 'active' },
  });

  return (allActive as unknown as Collaboration[]).filter((c) => {
    const timeout = c.timeoutMs || defaultTimeoutMs;
    return now - c.lastActivityAt > timeout;
  });
}
