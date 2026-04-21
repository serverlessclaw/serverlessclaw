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
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<Collaboration | null> {
    return this.underlying.getCollaboration(collaborationId, scope);
  }

  async checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: ParticipantType,
    requiredRole?: CollaborationRole,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<boolean> {
    return this.underlying.checkCollaborationAccess(
      collaborationId,
      participantId,
      participantType,
      requiredRole,
      scope
    );
  }

  async closeCollaboration(
    collaborationId: string,
    actorId: string,
    actorType: ParticipantType,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    return this.underlying.closeCollaboration(collaborationId, actorId, actorType, scope);
  }

  async createCollaboration(
    ownerId: string,
    ownerType: ParticipantType,
    input: CreateCollaborationInput,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<Collaboration> {
    return this.underlying.createCollaboration(ownerId, ownerType, input, scope);
  }

  async listCollaborationsForParticipant(
    participantId: string,
    participantType: ParticipantType,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<
    Array<{
      collaborationId: string;
      role: CollaborationRole;
      collaborationName: string;
    }>
  > {
    return this.underlying.listCollaborationsForParticipant(participantId, participantType, scope);
  }

  async transitToCollaboration(
    userId: string,
    scope: string | import('../../types/memory').ContextualScope,
    sourceSessionId: string,
    invitedAgentIds: string[],
    name?: string
  ): Promise<Collaboration> {
    return this.underlying.transitToCollaboration(
      userId,
      scope,
      sourceSessionId,
      invitedAgentIds,
      name
    );
  }
}
