/**
 * Collaboration Tools for Agent Multi-Party Collaboration
 * Enables agents to create and participate in shared sessions
 */

import { collaborationTools as definitions } from './definitions/collaboration';
import { ParticipantType, CollaborationRole } from '../lib/types/collaboration';
import { getAgentContext } from '../lib/utils/agent-helpers';
import { ITool } from '../lib/types/tool';
import { MessageRole } from '../lib/types/llm';

/**
 * Creates a new collaboration session.
 */
export const CREATE_COLLABORATION: ITool = {
  ...definitions.createCollaboration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = memory as any;
    const agentId = (args.agentId as string) ?? 'unknown';

    const collaboration = await mem.createCollaboration(agentId, 'agent', {
      name: args.name as string,
      description: args.description as string | undefined,
      sessionId: undefined, // Auto-generated
      ttlDays: args.ttlDays as number | undefined,
      tags: args.tags as string[] | undefined,
      initialParticipants: args.participants as
        | Array<{
            type: ParticipantType;
            id: string;
            role: CollaborationRole;
          }>
        | undefined,
    });

    return JSON.stringify({
      success: true,
      collaborationId: collaboration.collaborationId,
      sessionId: collaboration.sessionId,
      syntheticUserId: collaboration.syntheticUserId,
      participants: collaboration.participants,
      message: `Collaboration "${collaboration.name}" created. Use collaborationId for shared context.`,
    });
  },
};

/**
 * Joins an existing collaboration.
 */
export const JOIN_COLLABORATION: ITool = {
  ...definitions.joinCollaboration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = memory as any;
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const collaboration = await mem.getCollaboration(collaborationId);

    if (!collaboration) {
      return JSON.stringify({ success: false, error: 'Collaboration not found' });
    }

    const isParticipant = collaboration.participants.some(
      (p: { id: string; type: string }) => p.id === agentId && p.type === 'agent'
    );

    if (!isParticipant) {
      return JSON.stringify({ success: false, error: 'Not a participant in this collaboration' });
    }

    return JSON.stringify({
      success: true,
      collaborationId: collaboration.collaborationId,
      sessionId: collaboration.sessionId,
      syntheticUserId: collaboration.syntheticUserId,
      name: collaboration.name,
      participants: collaboration.participants,
    });
  },
};

/**
 * Gets the shared session context for a collaboration.
 */
export const GET_COLLABORATION_CONTEXT: ITool = {
  ...definitions.getCollaborationContext,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = memory as any;
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const limit = (args.limit as number) ?? 50;

    const collaboration = await mem.getCollaboration(collaborationId);
    if (!collaboration) {
      return JSON.stringify({ success: false, error: 'Collaboration not found' });
    }

    const hasAccess = await mem.checkCollaborationAccess(collaborationId, agentId, 'agent');

    if (!hasAccess) {
      return JSON.stringify({ success: false, error: 'Access denied' });
    }

    const history = await mem.getHistory(collaboration.syntheticUserId);
    const limitedHistory = history.slice(-limit);

    return JSON.stringify({
      success: true,
      collaborationId,
      sessionId: collaboration.sessionId,
      messageCount: limitedHistory.length,
      messages: limitedHistory.map(
        (m: { role: MessageRole; content?: string; agentName?: string }) => ({
          role: m.role,
          content: m.content,
          agentName: m.agentName,
        })
      ),
    });
  },
};

/**
 * Writes a message to the shared collaboration session.
 */
export const WRITE_TO_COLLABORATION: ITool = {
  ...definitions.writeToCollaboration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = memory as any;
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const content = args.content as string;
    const role = (args.role as string) ?? 'assistant';

    const collaboration = await mem.getCollaboration(collaborationId);
    if (!collaboration) {
      return JSON.stringify({ success: false, error: 'Collaboration not found' });
    }

    const hasAccess = await mem.checkCollaborationAccess(
      collaborationId,
      agentId,
      'agent',
      'editor'
    );

    if (!hasAccess) {
      return JSON.stringify({ success: false, error: 'Access denied or insufficient permissions' });
    }

    await mem.addMessage(collaboration.syntheticUserId, {
      role: role === 'user' ? MessageRole.USER : MessageRole.ASSISTANT,
      content,
      agentName: agentId,
    });

    return JSON.stringify({
      success: true,
      message: 'Message written to collaboration session',
    });
  },
};

/**
 * Lists collaborations for the current agent.
 */
export const LIST_MY_COLLABORATIONS: ITool = {
  ...definitions.listMyCollaborations,
  execute: async (_args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = memory as any;
    const agentId = (_args.agentId as string) ?? 'unknown';
    const collaborations = await mem.listCollaborationsForParticipant(agentId, 'agent');

    return JSON.stringify({
      success: true,
      count: collaborations.length,
      collaborations,
    });
  },
};
