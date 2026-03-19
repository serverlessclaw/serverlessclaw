/**
 * Agent Event Emitter Module
 *
 * Handles emitting task completion and failure events to EventBridge.
 * Extracted from agent-helpers.ts to improve modularity.
 */

import { logger } from '../../logger';
import { Resource } from 'sst';
import { EventType, Attachment, AgentType } from '../../types/index';

/** Singleton eventbridge client */
let _eventbridge: import('@aws-sdk/client-eventbridge').EventBridgeClient | undefined;
let _typedResource: { AgentBus: { name: string } } | undefined;

/**
 * Get or initialize the shared eventbridge client (singleton pattern).
 */
async function getEventBridge(): Promise<import('@aws-sdk/client-eventbridge').EventBridgeClient> {
  if (!_eventbridge) {
    const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
    _eventbridge = new EventBridgeClient({});
  }
  return _eventbridge;
}

/**
 * Get typed resource reference.
 */
function getTypedResource(): { AgentBus: { name: string } } {
  if (!_typedResource) {
    _typedResource = Resource as unknown as { AgentBus: { name: string } };
  }
  return _typedResource;
}

/**
 * Emit a task completion or failure event to EventBridge.
 * Used by all agents for universal coordination.
 *
 * @param params - The event parameters including source, agentId, userId, task, response/error, etc.
 */
export async function emitTaskEvent(params: {
  source: string;
  agentId: string | AgentType;
  userId: string;
  task: string;
  response?: string;
  error?: string;
  attachments?: Attachment[];
  traceId?: string;
  sessionId?: string;
  initiatorId?: string;
  depth?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const eventbridge = await getEventBridge();
  const typedResource = getTypedResource();
  const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
  const isFailure = !!params.error;

  try {
    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: params.source,
            DetailType: isFailure ? EventType.TASK_FAILED : EventType.TASK_COMPLETED,
            Detail: JSON.stringify({
              userId: params.userId,
              agentId: params.agentId,
              task: params.task,
              [isFailure ? 'error' : 'response']: params.error || params.response || '',
              attachments: params.attachments,
              traceId: params.traceId,
              initiatorId: params.initiatorId,
              depth: params.depth,
              sessionId: params.sessionId,
              metadata: params.metadata,
            }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    logger.error(`Failed to emit ${isFailure ? 'TASK_FAILED' : 'TASK_COMPLETED'}:`, e);
  }
}
