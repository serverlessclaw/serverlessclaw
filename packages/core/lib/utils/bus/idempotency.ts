import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDb, getMemoryTableName } from './client';
import { BUS } from '../../constants';
import { logger } from '../../logger';

const IDEMPOTENCY_TYPE = BUS.IDEMPOTENCY_TYPE;
const IDEMPOTENCY_PREFIX = BUS.IDEMPOTENCY_PREFIX;
const IDEMPOTENCY_TTL_SECONDS = BUS.IDEMPOTENCY_TTL_SECONDS;

const STATUS = {
  RESERVED: 'RESERVED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
};

export async function reserveIdempotencyKey(key: string, workspaceId?: string): Promise<boolean> {
  try {
    const tableName = await getMemoryTableName();
    const expiresAt = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';

    await getDb().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: `${scopePrefix}${IDEMPOTENCY_PREFIX}${key}`,
          timestamp: 0,
          type: IDEMPOTENCY_TYPE,
          status: STATUS.RESERVED,
          expiresAt,
          workspaceId,
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
    return false;
  }
}

export async function commitIdempotencyKey(
  key: string,
  eventId?: string,
  workspaceId?: string
): Promise<void> {
  try {
    const tableName = await getMemoryTableName();
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';
    await getDb().send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          userId: `${scopePrefix}${IDEMPOTENCY_PREFIX}${key}`,
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
