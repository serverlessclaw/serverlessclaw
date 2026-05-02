import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getAgentBusName } from './resource-helpers';
import { EventType } from '../types/index';
import { logger } from '../logger';
import { BUS, TIME } from '../constants';

const MAX_RETRIES = BUS.MAX_RETRIES;
const INITIAL_BACKOFF_MS = BUS.INITIAL_BACKOFF_MS;
const DLQ_TYPE = BUS.DLQ_TYPE;
const IDEMPOTENCY_TYPE = BUS.IDEMPOTENCY_TYPE;
const IDEMPOTENCY_PREFIX = BUS.IDEMPOTENCY_PREFIX;
const IDEMPOTENCY_TTL_SECONDS = BUS.IDEMPOTENCY_TTL_SECONDS;
const DLQ_PREFIX = BUS.DLQ_PREFIX;

export enum EventPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}

export enum ErrorCategory {
  TRANSIENT = 'TRANSIENT',
  PERMANENT = 'PERMANENT',
  UNKNOWN = 'UNKNOWN',
}

export interface EventOptions {
  priority?: EventPriority;
  idempotencyKey?: string;
  maxRetries?: number;
  correlationId?: string;
}

export interface DlqEntry {
  userId: string; // The partition key (EVENTBUS#DLQ#...)
  timestamp: number; // The range key
  type: string; // DLQ_EVENT
  source: string;
  detailType: string;
  detail: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  errorCategory?: ErrorCategory;
  priority: EventPriority;
  correlationId?: string;
  createdAt: number;
  expiresAt: number;
  workspaceId?: string;
}

let _eventbridge: EventBridgeClient | null = null;
let _db: DynamoDBDocumentClient | null = null;
let _busName: string | null = null;
let _memoryTableName: string | null = null;

const STATUS = {
  RESERVED: 'RESERVED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
};

/**
 * Initializes and returns the EventBridge client instance.
 */
function getEventBridge(): EventBridgeClient {
  if (!_eventbridge) _eventbridge = new EventBridgeClient({});
  return _eventbridge;
}

/**
 * Resets the EventBridge client (used for testing).
 */
export function resetEventBridge(): void {
  _eventbridge = null;
}

/**
 * Initializes and returns the DynamoDB document client instance.
 */
function getDb(): DynamoDBDocumentClient {
  if (!_db) {
    const client = new DynamoDBClient({});
    _db = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _db;
}

/**
 * Resets the DynamoDB document client (used for testing).
 */
export function resetDb(): void {
  _db = null;
}

/**
 * Retrieves the EventBridge bus name from environment configuration.
 */
async function getBusName(): Promise<string> {
  if (_busName === null) {
    _busName = getAgentBusName() ?? 'AgentBus';
  }
  return _busName;
}

/**
 * Retrieves the DynamoDB table name for memory and idempotency storage.
 */
async function getMemoryTableName(): Promise<string> {
  if (_memoryTableName === null) {
    const { getMemoryTableName: getTableName } = await import('./ddb-client');
    _memoryTableName = getTableName() ?? 'MemoryTable';
  }
  return _memoryTableName;
}

/**
 * Categorizes an error as transient or permanent for retry logic.
 */
function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (
      message.includes('throttling') ||
      message.includes('rate limit') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('temporary') ||
      message.includes('service unavailable') ||
      message.includes('too many requests')
    ) {
      return ErrorCategory.TRANSIENT;
    }

    if (
      message.includes('access denied') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('not found') ||
      message.includes('invalid') ||
      message.includes('malformed')
    ) {
      return ErrorCategory.PERMANENT;
    }
  }
  return ErrorCategory.UNKNOWN;
}

/**
 * Reserves an idempotency key in DynamoDB to prevent concurrent duplicate processing.
 */
async function reserveIdempotencyKey(key: string): Promise<boolean> {
  try {
    const tableName = await getMemoryTableName();
    const expiresAt = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;

    await getDb().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: `${IDEMPOTENCY_PREFIX}${key}`,
          timestamp: 0,
          type: IDEMPOTENCY_TYPE,
          status: STATUS.RESERVED,
          expiresAt,
        },
        ConditionExpression: 'attribute_not_exists(userId)',
      })
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    logger.error(`Idempotency reservation failed for ${key}:`, error);
    return false; // Block the event if DDB is down - prevents duplicate emissions
  }
}

/**
 * Commits an idempotency key once the event has been successfully emitted.
 */
async function commitIdempotencyKey(key: string, eventId?: string): Promise<void> {
  try {
    const tableName = await getMemoryTableName();
    await getDb().send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          userId: `${IDEMPOTENCY_PREFIX}${key}`,
          timestamp: 0,
        },
        UpdateExpression: 'SET #status = :committed, eventId = :eventId, committedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':committed': STATUS.COMMITTED,
          ':eventId': eventId ?? 'N/A',
          ':now': Date.now(),
        },
        ConditionExpression: 'attribute_exists(userId)',
      })
    );
  } catch (error) {
    logger.warn(`Failed to commit idempotency key ${key}:`, error);
  }
}

/**
 * Persists a failed event to the Dead Letter Queue in DynamoDB.
 */
async function storeInDLQ(
  source: string,
  type: string,
  detail: Record<string, unknown>,
  options: {
    retryCount: number;
    maxRetries: number;
    lastError?: string;
    errorCategory?: ErrorCategory;
    priority: EventPriority;
    correlationId?: string;
  },
  idempotencyKey?: string
): Promise<void> {
  try {
    const tableName = await getMemoryTableName();
    const now = Date.now();
    const expiresAt = Math.floor(now / 1000) + TIME.SECONDS_IN_DAY; // 24 hours for DLQ

    const workspaceId = (detail.workspaceId as string) || undefined;
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';

    // Use deterministic key if provided, otherwise generate from event content
    const dlqKey = idempotencyKey
      ? `${scopePrefix}${DLQ_PREFIX}#${idempotencyKey}`
      : `${scopePrefix}${DLQ_PREFIX}#${now}#${type.slice(0, 20)}`;

    await getDb().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: dlqKey,
          timestamp: now,
          type: DLQ_TYPE,
          source,
          detailType: type,
          detail: JSON.stringify(detail),
          retryCount: options.retryCount,
          maxRetries: options.maxRetries,
          lastError: options.lastError,
          errorCategory: options.errorCategory ?? ErrorCategory.UNKNOWN,
          priority: options.priority,
          correlationId: options.correlationId,
          createdAt: now,
          expiresAt,
          workspaceId,
        },
      })
    );

    const priorityLabel = options.priority ?? EventPriority.NORMAL;
    const errorCat = options.errorCategory ?? ErrorCategory.UNKNOWN;
    logger.warn(
      `Event stored in DLQ: ${source}/${type} (WS: ${workspaceId || 'GLOBAL'}) | Retries: ${options.retryCount}/${options.maxRetries} | Priority: ${priorityLabel} | Error: ${errorCat}`
    );
  } catch (dlqError) {
    logger.error('Failed to store event in DLQ:', dlqError);
  }
}

/**
 * Emits an event to the EventBridge bus with retry logic and DLQ fallback.
 * @param source - The event source.
 * @param type - The event type or detail type.
 * @param detail - The event payload.
 * @param options - Emission options (priority, idempotency, retries).
 * @returns Result status with event ID if successful.
 */
export async function emitEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: EventOptions = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  const {
    priority = EventPriority.NORMAL,
    idempotencyKey,
    maxRetries = MAX_RETRIES,
    correlationId,
  } = options;

  if (idempotencyKey) {
    const reserved = await reserveIdempotencyKey(idempotencyKey);
    if (!reserved) {
      logger.info(`Duplicate event detected via idempotency key: ${idempotencyKey}`);
      return { success: false, reason: 'DUPLICATE' };
    }
  }

  const busName = await getBusName();
  const detailJson = JSON.stringify(detail);

  logger.info(
    `[BUS_EMIT] From: ${source} | Type: ${type} | Priority: ${priority} | Session: ${detail.sessionId ?? 'N/A'} | User: ${detail.userId ?? 'N/A'} | Org: ${detail.orgId ?? 'N/A'} | Correlation: ${correlationId ?? 'N/A'}`
  );

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: source,
            DetailType: type,
            Detail: detailJson,
            EventBusName: busName,
          },
        ],
      });

      const result = await getEventBridge().send(command);

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        logger.warn(
          `EventBridge reported ${result.FailedEntryCount} failed entries on attempt ${attempt}/${maxRetries}`
        );
        if (attempt < maxRetries) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          await sleep(backoff);
          continue;
        }
        // Final attempt also failed — store in DLQ and return failure
        await storeInDLQ(
          source,
          type as string,
          detail,
          {
            retryCount: attempt,
            maxRetries,
            lastError: `EventBridge FailedEntryCount=${result.FailedEntryCount}`,
            errorCategory: ErrorCategory.UNKNOWN,
            priority,
            correlationId,
          },
          idempotencyKey
        );
        return { success: false, reason: 'DLQ' };
      }

      if (idempotencyKey) {
        await commitIdempotencyKey(idempotencyKey, result.Entries?.[0]?.EventId);
      }

      return { success: true, eventId: result.Entries?.[0]?.EventId };
    } catch (error) {
      const errorCategory = categorizeError(error);
      const isPermanent = errorCategory === ErrorCategory.PERMANENT;
      const isRetryable =
        errorCategory === ErrorCategory.TRANSIENT || errorCategory === ErrorCategory.UNKNOWN;

      logger.error(
        `EventBridge emit attempt ${attempt}/${maxRetries} failed from ${source} (${errorCategory}):`,
        error
      );

      if (isPermanent) {
        await storeInDLQ(
          source,
          type as string,
          detail,
          {
            retryCount: attempt,
            maxRetries,
            lastError: error instanceof Error ? error.message : String(error),
            errorCategory,
            priority,
            correlationId,
          },
          idempotencyKey
        );
        return { success: false, reason: 'PERMANENT_ERROR' };
      }

      if (attempt < maxRetries && isRetryable) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await sleep(backoff);
      } else if (attempt >= maxRetries) {
        await storeInDLQ(
          source,
          type as string,
          detail,
          {
            retryCount: attempt,
            maxRetries,
            lastError: error instanceof Error ? error.message : String(error),
            errorCategory,
            priority,
            correlationId,
          },
          idempotencyKey
        );
        return { success: false, reason: 'DLQ' };
      }
    }
  }

  return { success: false, reason: 'MAX_RETRIES' };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDlqEntries(
  options: { limit?: number; workspaceId?: string } = {}
): Promise<DlqEntry[]> {
  const { limit = 50, workspaceId } = options;
  try {
    const tableName = await getMemoryTableName();
    const result = await getDb().send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'TypeTimestampIndex',
        KeyConditionExpression: '#type = :type AND #ts > :cutoff',
        ExpressionAttributeNames: {
          '#type': 'type',
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':type': DLQ_TYPE,
          ':cutoff': Date.now() - TIME.MS_PER_DAY, // Last 24 hours
        },
        ScanIndexForward: false, // Newest first
        Limit: workspaceId ? limit * 5 : limit, // Fetch more if filtering by workspace
      })
    );

    let items = (result.Items ?? []) as DlqEntry[];

    if (workspaceId) {
      items = items.filter((item) => item.workspaceId === workspaceId);
    }

    return items.slice(0, limit);
  } catch (error) {
    logger.error('Failed to get DLQ entries:', error);
    return [];
  }
}

/**
 * Retries an entry from DLQ and deletes it on success.
 * Purges the original entry first to prevent accumulation on repeated failures.
 * Uses an idempotency key to protect against concurrent retry calls.
 */
export async function retryDlqEntry(entry: DlqEntry): Promise<boolean> {
  try {
    const detail = JSON.parse(entry.detail);

    // Use a stable idempotency key to protect against concurrent retries of the same entry
    const idempotencyKey = `dlq-retry:${entry.userId}:${entry.timestamp}`;

    const result = await emitEvent(entry.source, entry.detailType, detail, {
      priority: entry.priority as EventPriority,
      correlationId: entry.correlationId,
      maxRetries: 2,
      idempotencyKey,
    });

    // If emission succeeded or was blocked as a duplicate (meaning it already succeeded), purge the original
    if (result.success || result.reason === 'DUPLICATE') {
      await purgeDlqEntry(entry);
      return true;
    }

    return false;
    // If emitEvent fails, it will write to DLQ again with a new key — that new entry is the correct survivor
  } catch (error) {
    logger.error('Failed to retry DLQ entry:', error);
    return false;
  }
}

/**
 * Permanently removes a DLQ entry.
 */
export async function purgeDlqEntry(
  entry: DlqEntry | { userId: string; timestamp: number }
): Promise<void> {
  try {
    const tableName = await getMemoryTableName();
    await getDb().send(
      new DeleteCommand({
        TableName: tableName,
        Key: { userId: entry.userId, timestamp: entry.timestamp },
      })
    );
    logger.info(`DLQ entry purged: ${entry.userId}`);
  } catch (error) {
    logger.error(`Failed to purge DLQ entry ${entry.userId}:`, error);
  }
}

export async function emitEventWithIdempotency(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'idempotencyKey'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  // Require traceId for stable, deterministic idempotency key
  if (!detail.traceId) {
    const error =
      '[emitEventWithIdempotency] traceId is required on detail for a stable, deterministic idempotency key. ' +
      'If you have no traceId, use emitEvent() with explicit idempotencyKey or accept no dedup.';
    logger.error(error);
    throw new Error(error);
  }

  const idempotencyKey = `${source}:${type}:${detail.sessionId ?? 'global'}:${detail.traceId}`;

  return emitEvent(source, type, detail, {
    ...options,
    idempotencyKey,
  });
}

export async function emitCriticalEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'priority'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  return emitEvent(source, type, detail, {
    ...options,
    priority: EventPriority.CRITICAL,
    maxRetries: options.maxRetries ?? 5,
  });
}

export async function emitHighPriorityEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'priority'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  return emitEvent(source, type, detail, {
    ...options,
    priority: EventPriority.HIGH,
    maxRetries: options.maxRetries ?? 3,
  });
}

export async function emitLowPriorityEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'priority'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  return emitEvent(source, type, detail, {
    ...options,
    priority: EventPriority.LOW,
    maxRetries: options.maxRetries ?? 1,
  });
}
