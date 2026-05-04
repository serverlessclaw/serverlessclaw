import { ContextualScope, ClarificationState, ClarificationStatus } from '../../types';
import { DynamoMemorySessions } from './sessions';
import * as ClarificationOps from '../clarification-operations';
import * as CollaborationOps from '../collaboration-operations';
import * as MemoryUtils from '../utils';

/**
 * DynamoMemory implementation for Collaboration and Clarification operations.
 */
export class DynamoMemoryCollaboration extends DynamoMemorySessions {
  async saveClarificationRequest(
    state: Omit<ClarificationState, 'type' | 'expiresAt' | 'timestamp'>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return ClarificationOps.saveClarificationRequest(this, state, scope);
  }

  async getClarificationRequest(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<ClarificationState | null> {
    return ClarificationOps.getClarificationRequest(this, traceId, agentId, scope);
  }

  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: ClarificationStatus,
    scope?: string | ContextualScope
  ): Promise<void> {
    return ClarificationOps.updateClarificationStatus(this, traceId, agentId, status, scope);
  }

  async saveEscalationState(
    state: import('../../types/escalation').EscalationState,
    scope?: string | ContextualScope
  ): Promise<void> {
    return ClarificationOps.saveEscalationState(this, state, scope);
  }

  async getEscalationState(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<import('../../types/escalation').EscalationState | null> {
    return ClarificationOps.getEscalationState(this, traceId, agentId, scope);
  }

  async findExpiredClarifications(scope?: string | ContextualScope): Promise<ClarificationState[]> {
    return ClarificationOps.findExpiredClarifications(this, scope);
  }

  async incrementClarificationRetry(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<number> {
    return ClarificationOps.incrementClarificationRetry(this, traceId, agentId, scope);
  }

  async createCollaboration(
    ownerId: string,
    ownerType: import('../../types/collaboration').ParticipantType,
    input: import('../../types/collaboration').CreateCollaborationInput,
    scope?: string | ContextualScope
  ): Promise<import('../../types/collaboration').Collaboration> {
    return CollaborationOps.createCollaboration(this, ownerId, ownerType, input, scope);
  }

  async getCollaboration(
    collaborationId: string,
    scope?: string | ContextualScope
  ): Promise<import('../../types/collaboration').Collaboration | null> {
    return CollaborationOps.getCollaboration(this, collaborationId, scope);
  }

  async checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: import('../../types/collaboration').ParticipantType,
    requiredRole?: import('../../types/collaboration').CollaborationRole,
    scope?: string | ContextualScope
  ): Promise<boolean> {
    return CollaborationOps.checkCollaborationAccess(
      this,
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
    actorType: import('../../types/collaboration').ParticipantType,
    scope?: string | ContextualScope
  ): Promise<void> {
    return CollaborationOps.closeCollaboration(this, collaborationId, actorId, actorType, scope);
  }

  async addCollaborationParticipant(
    collaborationId: string,
    actorId: string,
    actorType: import('../../types/collaboration').ParticipantType,
    newParticipant: {
      type: import('../../types/collaboration').ParticipantType;
      id: string;
      role: import('../../types/collaboration').CollaborationRole;
    },
    scope?: string | ContextualScope
  ): Promise<void> {
    return CollaborationOps.addCollaborationParticipant(
      this,
      collaborationId,
      actorId,
      actorType,
      newParticipant,
      scope
    );
  }

  async listCollaborationsForParticipant(
    participantId: string,
    participantType: import('../../types/collaboration').ParticipantType,
    scope?: string | ContextualScope
  ): Promise<
    Array<{
      collaborationId: string;
      role: import('../../types/collaboration').CollaborationRole;
      collaborationName: string;
    }>
  > {
    return CollaborationOps.listCollaborationsForParticipant(
      this,
      participantId,
      participantType,
      scope
    );
  }

  async findStaleCollaborations(
    defaultTimeoutMs: number,
    scope?: string | ContextualScope
  ): Promise<import('../../types/collaboration').Collaboration[]> {
    return CollaborationOps.findStaleCollaborations(this, defaultTimeoutMs, scope);
  }

  async transitToCollaboration(
    userId: string,
    scope: string | ContextualScope,
    sourceSessionId: string,
    invitedAgentIds: string[],
    name?: string
  ): Promise<import('../../types/collaboration').Collaboration> {
    return CollaborationOps.transitToCollaboration(
      this,
      userId,
      scope,
      sourceSessionId,
      invitedAgentIds,
      name
    );
  }

  async getMemoryByTypePaginated(
    type: string,
    limit: number = 100,
    lastEvaluatedKey?: Record<string, unknown>,
    scope?: string | ContextualScope
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return MemoryUtils.getMemoryByTypePaginated(this, type, limit, lastEvaluatedKey, scope);
  }

  async getMemoryByType(
    type: string,
    limit: number = 100,
    scope?: string | ContextualScope
  ): Promise<Record<string, unknown>[]> {
    const { items } = await MemoryUtils.getMemoryByTypePaginated(
      this,
      type,
      limit,
      undefined,
      scope
    );
    return items;
  }

  async getRegisteredMemoryTypes(): Promise<string[]> {
    return MemoryUtils.getRegisteredMemoryTypes(this);
  }
}
