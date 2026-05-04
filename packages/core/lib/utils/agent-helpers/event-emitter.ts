/**
 * Agent Event Emitter Module
 *
 * Handles emitting task completion and failure events to EventBridge.
 * Implements retry with exponential backoff and DLQ fallback.
 * Extracted from agent-helpers.ts to improve modularity.
 */

import { Attachment, AgentRole, EventType } from '../../types/index';
import { emitTypedEvent } from '../typed-emit';

/**
 * Emit a task completion or failure event to EventBridge.
 * Used by all agents for universal coordination.
 *
 * @param params - The event parameters including source, agent, user, task, and optional metadata.
 */
export async function emitTaskEvent(params: {
  source: string;
  agentId: string | AgentRole;
  userId: string;
  task: string;
  response?: string;
  error?: string;
  attachments?: Attachment[];
  traceId?: string;
  taskId?: string;
  sessionId?: string;
  initiatorId?: string;
  depth?: number;
  workspaceId?: string;
  teamId?: string;
  staffId?: string;
  userRole?: string;
  metadata?: Record<string, unknown>;
  userNotified?: boolean;
  idempotencyKey?: string;
}): Promise<void> {
  const isFailure = !!params.error;
  const eventType = isFailure ? EventType.TASK_FAILED : EventType.TASK_COMPLETED;

  const detail = {
    userId: params.userId,
    agentId: params.agentId,
    task: params.task,
    [isFailure ? 'error' : 'response']: isFailure ? (params.error ?? '') : (params.response ?? ''),
    attachments: params.attachments,
    traceId: params.traceId,
    taskId: params.taskId,
    initiatorId: params.initiatorId,
    depth: params.depth,
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    teamId: params.teamId,
    staffId: params.staffId,
    userRole: params.userRole,
    metadata: params.metadata,
    userNotified: params.userNotified,
  };

  // Delegate to typed emitter for validation and emission
  await emitTypedEvent(params.source, eventType, detail, {
    idempotencyKey: params.idempotencyKey,
  });
}
