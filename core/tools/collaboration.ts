/**
 * Collaboration Tools for Agent Multi-Party Collaboration
 * Enables agents to create and participate in shared sessions
 */

import { collaborationTools as definitions } from './definitions/collaboration';
import { ParticipantType, CollaborationRole } from '../lib/types/collaboration';
import { getAgentContext } from '../lib/utils/agent-helpers';
import { ITool } from '../lib/types/tool';
import { MessageRole } from '../lib/types/llm';
import { addTraceStep } from '../lib/utils/trace-helper';
import { TraceType } from '../lib/types/constants';
import { AgentType } from '../lib/types/agent';
import { emitTypedEvent } from '../lib/utils/typed-emit';
import { logger } from '../lib/logger';

/**
 * Creates a new collaboration session.
 */
export const CREATE_COLLABORATION: ITool = {
  ...definitions.createCollaboration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    const agentId = (args.agentId as string) ?? 'unknown';
    const traceId = (args.traceId as string) ?? undefined;
    const userId = (args.userId as string) ?? 'unknown';
    const workspaceId = args.workspaceId as string | undefined;

    // Ensure Facilitator is invited as an editor (to summarize and close)
    const initialParticipants =
      (args.participants as
        | Array<{
            type: ParticipantType;
            id: string;
            role: CollaborationRole;
          }>
        | undefined) ?? [];

    if (!initialParticipants.some((p) => p.id === AgentType.FACILITATOR)) {
      initialParticipants.push({
        type: 'agent',
        id: AgentType.FACILITATOR,
        role: 'editor',
      });
    }

    // If workspaceId provided, auto-add all active workspace members (agents + humans)
    if (workspaceId) {
      try {
        const { getWorkspace } = await import('../lib/memory/workspace-operations');
        const workspace = await getWorkspace(workspaceId);
        if (workspace) {
          for (const member of workspace.members) {
            if (!member.active) continue;

            // Skip if already in participants list
            if (initialParticipants.some((p) => p.id === member.memberId)) continue;

            // Map WorkspaceRole to CollaborationRole
            let collabRole: 'editor' | 'viewer' = 'editor';
            if (member.role === 'observer') {
              collabRole = 'viewer';
            }

            initialParticipants.push({
              type: member.type,
              id: member.memberId,
              role: collabRole,
            });
          }
          logger.info(
            `[Collaboration] Auto-added ${workspace.members.length} workspace members to collaboration`
          );
        }
      } catch (err) {
        logger.warn('[Collaboration] Failed to load workspace members:', err);
      }
    }

    const collaboration = await memory.createCollaboration(agentId, 'agent', {
      name: args.name as string,
      description: args.description as string | undefined,
      sessionId: undefined, // Auto-generated
      ttlDays: args.ttlDays as number | undefined,
      tags: args.tags as string[] | undefined,
      initialParticipants,
      workspaceId,
    });

    if (traceId) {
      await addTraceStep(traceId, 'root', {
        type: TraceType.COLLABORATION_STARTED,
        content: {
          collaborationId: collaboration.collaborationId,
          name: collaboration.name,
          participants: collaboration.participants,
        },
      });
    }

    // Wake up the Facilitator to start moderating
    try {
      await emitTypedEvent('collaboration.tool', `${AgentType.FACILITATOR}_task`, {
        userId,
        task: `A new collaboration session "${collaboration.name}" has been created. Please start moderating. Collaboration ID: ${collaboration.collaborationId}`,
        traceId,
        initiatorId: agentId,
        metadata: { collaborationId: collaboration.collaborationId },
      });
    } catch (e) {
      console.warn('Failed to wake up Facilitator Agent:', e);
    }

    return JSON.stringify({
      success: true,
      collaborationId: collaboration.collaborationId,
      sessionId: collaboration.sessionId,
      syntheticUserId: collaboration.syntheticUserId,
      participants: collaboration.participants,
      message: `Collaboration "${collaboration.name}" created. Use collaborationId for shared context. Facilitator invited.`,
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
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const collaboration = await memory.getCollaboration(collaborationId);

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
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const limit = (args.limit as number) ?? 50;

    const collaboration = await memory.getCollaboration(collaborationId);
    if (!collaboration) {
      return JSON.stringify({ success: false, error: 'Collaboration not found' });
    }

    const hasAccess = await memory.checkCollaborationAccess(collaborationId, agentId, 'agent');

    if (!hasAccess) {
      return JSON.stringify({ success: false, error: 'Access denied' });
    }

    const history = await memory.getHistory(collaboration.syntheticUserId);
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
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const content = args.content as string;
    const role = (args.role as string) ?? 'assistant';

    const traceId = (args.traceId as string) ?? undefined;

    const collaboration = await memory.getCollaboration(collaborationId);
    if (!collaboration) {
      return JSON.stringify({ success: false, error: 'Collaboration not found' });
    }

    const hasAccess = await memory.checkCollaborationAccess(
      collaborationId,
      agentId,
      'agent',
      'editor'
    );

    if (!hasAccess) {
      return JSON.stringify({ success: false, error: 'Access denied or insufficient permissions' });
    }

    await memory.addMessage(collaboration.syntheticUserId, {
      role: role === 'user' ? MessageRole.USER : MessageRole.ASSISTANT,
      content,
      agentName: agentId,
    });

    if (traceId) {
      await addTraceStep(traceId, 'root', {
        type: TraceType.COUNCIL_REVIEW, // Or add a more generic COLLABORATION_MESSAGE type if needed
        content: {
          collaborationId,
          agentId,
          content: content.substring(0, 200),
        },
      });
    }

    return JSON.stringify({
      success: true,
      message: 'Message written to collaboration session',
    });
  },
};

/**
 * Closes a collaboration session.
 */
export const CLOSE_COLLABORATION: ITool = {
  ...definitions.closeCollaboration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    const agentId = (args.agentId as string) ?? 'unknown';
    const collaborationId = args.collaborationId as string;
    const traceId = (args.traceId as string) ?? undefined;

    try {
      await memory.closeCollaboration(collaborationId, agentId, 'agent');

      if (traceId) {
        await addTraceStep(traceId, 'root', {
          type: TraceType.COLLABORATION_COMPLETED,
          content: {
            collaborationId,
            status: 'closed',
          },
        });
      }

      return JSON.stringify({
        success: true,
        message: `Collaboration ${collaborationId} closed successfully.`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

/**
 * Lists collaborations for the current agent.
 */
export const LIST_MY_COLLABORATIONS: ITool = {
  ...definitions.listMyCollaborations,
  execute: async (_args: Record<string, unknown>): Promise<string> => {
    const { memory } = await getAgentContext();
    const agentId = (_args.agentId as string) ?? 'unknown';
    const collaborations = await memory.listCollaborationsForParticipant(agentId, 'agent');

    return JSON.stringify({
      success: true,
      count: collaborations.length,
      collaborations,
    });
  },
};
