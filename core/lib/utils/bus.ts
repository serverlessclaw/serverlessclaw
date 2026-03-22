import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventType } from '../types/index';
import { logger } from '../logger';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 100;
const DLQ_TABLE_KEY = 'EVENTBUS#DLQ';

let _eventbridge: EventBridgeClient | null = null;
let _db: DynamoDBDocumentClient | null = null;
let _busName: string | null = null;
let _memoryTableName: string | null = null;

function getEventBridge(): EventBridgeClient {
  if (!_eventbridge) {
    _eventbridge = new EventBridgeClient({});
  }
  return _eventbridge;
}

function getDb(): DynamoDBDocumentClient {
  if (!_db) {
    _db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return _db;
}

async function getBusName(): Promise<string> {
  if (_busName === null) {
    try {
      const { Resource } = await import('sst');
      _busName = Resource.AgentBus?.name ?? 'AgentBus';
    } catch {
      _busName = 'AgentBus';
    }
  }
  return _busName;
}

async function getMemoryTableName(): Promise<string> {
  if (_memoryTableName === null) {
    try {
      const { Resource } = await import('sst');
      _memoryTableName = Resource.MemoryTable?.name ?? 'MemoryTable';
    } catch {
      _memoryTableName = 'MemoryTable';
    }
  }
  return _memoryTableName;
}

async function storeInDLQ(
  source: string,
  type: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    const tableName = await getMemoryTableName();
    await getDb().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: `${DLQ_TABLE_KEY}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          type: 'DLQ_EVENT',
          source,
          detailType: type,
          detail: JSON.stringify(detail),
          retryCount: MAX_RETRIES,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      })
    );
    logger.warn(`Event stored in DLQ after ${MAX_RETRIES} retries: ${source}/${type}`);
  } catch (dlqError) {
    logger.error('Failed to store event in DLQ:', dlqError);
  }
}

/**
 * Shared utility for emitting events to the system AgentBus.
 * Implements retry with exponential backoff and DLQ fallback.
 *
 * @param source - The source identifier for the event (e.g., 'heartbeat.scheduler').
 * @param type - The event type (e.g., EventType.HEARTBEAT_PROACTIVE).
 * @param detail - The event detail payload as a record of key-value pairs.
 */
export async function emitEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>
): Promise<void> {
  const busName = await getBusName();
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: source,
        DetailType: type,
        Detail: JSON.stringify(detail),
        EventBusName: busName,
      },
    ],
  });

  logger.info(
    `[BUS_EMIT] From: ${source} | Type: ${type} | Session: ${detail.sessionId ?? 'N/A'} | User: ${detail.userId ?? 'N/A'}`
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await getEventBridge().send(command);
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
      logger.error(
        `EventBridge emit attempt ${attempt}/${MAX_RETRIES} failed from ${source}:`,
        error
      );
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  await storeInDLQ(source, type as string, detail);
}
