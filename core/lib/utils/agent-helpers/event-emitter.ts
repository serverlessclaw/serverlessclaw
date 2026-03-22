/**
 * Agent Event Emitter Module
 *
 * Handles emitting task completion and failure events to EventBridge.
 * Implements retry with exponential backoff and DLQ fallback.
 * Extracted from agent-helpers.ts to improve modularity.
 */

import { logger } from '../../logger';
import { Resource } from 'sst';
import { EventType, Attachment, AgentType } from '../../types/index';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 100;
const DLQ_TABLE_KEY = 'EVENTBUS#DLQ';

let _eventbridge: import('@aws-sdk/client-eventbridge').EventBridgeClient | undefined;
let _typedResource: { AgentBus: { name: string }; MemoryTable?: { name: string } } | undefined;
let _db: DynamoDBDocumentClient | undefined;

async function getEventBridge(): Promise<import('@aws-sdk/client-eventbridge').EventBridgeClient> {
  if (!_eventbridge) {
    const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
    _eventbridge = new EventBridgeClient({});
  }
  return _eventbridge;
}

function getTypedResource(): { AgentBus: { name: string }; MemoryTable?: { name: string } } {
  if (!_typedResource) {
    _typedResource = Resource as unknown as {
      AgentBus: { name: string };
      MemoryTable?: { name: string };
    };
  }
  return _typedResource;
}

async function getDb(): Promise<DynamoDBDocumentClient> {
  if (!_db) {
    _db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return _db;
}

async function storeInDLQ(
  source: string,
  detailType: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    const db = await getDb();
    const typedResource = getTypedResource();
    await db.send(
      new PutCommand({
        TableName: typedResource.MemoryTable?.name ?? 'MemoryTable',
        Item: {
          userId: `${DLQ_TABLE_KEY}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          type: 'DLQ_EVENT',
          source,
          detailType,
          detail: JSON.stringify(detail),
          retryCount: MAX_RETRIES,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      })
    );
    logger.warn(`Task event stored in DLQ after ${MAX_RETRIES} retries: ${source}/${detailType}`);
  } catch (dlqError) {
    logger.error('Failed to store task event in DLQ:', dlqError);
  }
}

async function emitWithRetry(
  eventbridge: import('@aws-sdk/client-eventbridge').EventBridgeClient,
  params: {
    source: string;
    detailType: string;
    detail: Record<string, unknown>;
    busName: string;
  }
): Promise<void> {
  const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: params.source,
        DetailType: params.detailType,
        Detail: JSON.stringify(params.detail),
        EventBusName: params.busName,
      },
    ],
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await eventbridge.send(command);
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        logger.warn(
          `EventBridge reported ${result.FailedEntryCount} failed entries on attempt ${attempt}`
        );
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }
      return;
    } catch (error) {
      logger.error(`EventBridge emit attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  await storeInDLQ(params.source, params.detailType, params.detail);
}

/**
 * Emit a task completion or failure event to EventBridge.
 * Used by all agents for universal coordination.
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
  userNotified?: boolean;
}): Promise<void> {
  const eventbridge = await getEventBridge();
  const typedResource = getTypedResource();
  const isFailure = !!params.error;
  const detailType = isFailure ? EventType.TASK_FAILED : EventType.TASK_COMPLETED;

  const detail = {
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
    userNotified: params.userNotified,
  };

  await emitWithRetry(eventbridge, {
    source: params.source,
    detailType,
    detail,
    busName: typedResource.AgentBus.name,
  });
}
