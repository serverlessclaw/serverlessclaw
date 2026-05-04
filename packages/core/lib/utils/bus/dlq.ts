import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDb, getMemoryTableName } from './client';
import { BUS, TIME } from '../../constants';
import { logger } from '../../logger';
import { DlqEntry, EventPriority, ErrorCategory } from './types';

const DLQ_TYPE = BUS.DLQ_TYPE;
const DLQ_PREFIX = BUS.DLQ_PREFIX;

export async function storeInDLQ(
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
    const expiresAt = Math.floor(now / 1000) + TIME.SECONDS_IN_DAY;

    const workspaceId = (detail.workspaceId as string) || undefined;
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';

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

    logger.warn(`Event stored in DLQ: ${source}/${type} | WS: ${workspaceId || 'GLOBAL'}`);
  } catch (dlqError) {
    logger.error('Failed to store event in DLQ:', dlqError);
  }
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
        FilterExpression: workspaceId ? 'workspaceId = :ws' : undefined,
        ExpressionAttributeNames: {
          '#type': 'type',
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':type': DLQ_TYPE,
          ':cutoff': Date.now() - TIME.MS_PER_DAY,
          ...(workspaceId ? { ':ws': workspaceId } : {}),
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    return (result.Items ?? []) as DlqEntry[];
  } catch (error) {
    logger.error('Failed to get DLQ entries:', error);
    return [];
  }
}

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
