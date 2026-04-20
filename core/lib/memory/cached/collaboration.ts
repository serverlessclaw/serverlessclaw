import { DynamoMemory } from '../dynamo-memory';
import type {
  Collaboration,
  CollaborationRole,
  ParticipantType,
  CreateCollaborationInput,
} from '../../types/collaboration';

/**
 * Handles collaboration-related memory operations for the CachedMemory provider.
 */
export class MemoryCollaboration {
  constructor(private readonly underlying: DynamoMemory) {}

  async getCollaboration(
    collaborationId: string,
    workspaceId?: string
  ): Promise<Collaboration | null> {
    return this.underlying.getCollaboration(collaborationId, workspaceId);
  }

  async checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: ParticipantType,
    requiredRole?: CollaborationRole,
    workspaceId?: string
  ): Promise<boolean> {
    return this.underlying.checkCollaborationAccess(
      collaborationId,
      participantId,
      participantType,
      requiredRole,
      workspaceId
    );
  }

  async closeCollaboration(
    collaborationId: string,
    actorId: string,
    actorType: ParticipantType,
    workspaceId?: string
  ): Promise<void> {
    return this.underlying.closeCollaboration(collaborationId, actorId, actorType, workspaceId);
  }

  async createCollaboration(
    ownerId: string,
    ownerType: ParticipantType,
    input: CreateCollaborationInput,
    workspaceId?: string
  ): Promise<Collaboration> {
    return this.underlying.createCollaboration(ownerId, ownerType, input, workspaceId);
  }

  async listCollaborationsForParticipant(
    participantId: string,
    participantType: ParticipantType,
    workspaceId?: string
  ): Promise<
    Array<{
      collaborationId: string;
      role: CollaborationRole;
      collaborationName: string;
    }>
  > {
    return this.underlying.listCollaborationsForParticipant(
      participantId,
      participantType,
      workspaceId
    );
  }

  async transitToCollaboration(
    userId: string,
    workspaceId: string,
    sourceSessionId: string,
    invitedAgentIds: string[],
    name?: string
  ): Promise<Collaboration> {
    return this.underlying.transitToCollaboration(
      userId,
      workspaceId,
      sourceSessionId,
      invitedAgentIds,
      name
    );
  }
}
