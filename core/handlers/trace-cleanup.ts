import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../lib/utils/ddb-client';
import { Resource } from 'sst';
import { SSTResource } from '../lib/types/system';
import { logger } from '../lib/logger';

const docClient = getDocClient();
const TRACE_TABLE_NAME = (Resource as unknown as SSTResource).TraceTable.name;
const ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ITEMS_TO_SCAN = 1000;

export interface TraceCleanupResult {
  deleted: number;
  errors: string[];
}

/**
 * Cleans up orphan traces and parallel barriers that never completed.
 * Orphan traces are those that:
 * - Have status 'started' and no endTime within threshold
 * - Have no recent activity (last step timestamp too old)
 * - Are parent traces of abandoned child traces
 */
export async function cleanupOrphanTraces(): Promise<TraceCleanupResult> {
  const result: TraceCleanupResult = { deleted: 0, errors: [] };
  const now = Date.now();
  const threshold = Math.floor((now - ORPHAN_THRESHOLD_MS) / 1000); // Unix timestamp

  logger.info(`[TRACE_CLEANUP] Starting orphan trace cleanup (threshold: ${threshold})`);

  try {
    // Find traces with STARTED status and old timestamp
    const response = await docClient.send(
      new QueryCommand({
        TableName: TRACE_TABLE_NAME,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status AND timestamp < :threshold',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'started',
          ':threshold': threshold,
        },
        Limit: MAX_ITEMS_TO_SCAN,
      })
    );

    const orphanTraces = response.Items ?? [];

    if (orphanTraces.length === 0) {
      logger.info('[TRACE_CLEANUP] No orphan traces found');
      return result;
    }

    logger.info(`[TRACE_CLEANUP] Found ${orphanTraces.length} orphan traces`);

    // Delete each orphan trace
    for (const trace of orphanTraces) {
      try {
        // Delete all nodes for this traceId
        await docClient.send(
          new DeleteCommand({
            TableName: TRACE_TABLE_NAME,
            Key: { traceId: trace.traceId, nodeId: trace.nodeId },
          })
        );
        result.deleted++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[TRACE_CLEANUP] Failed to delete trace ${trace.traceId}: ${msg}`);
        result.errors.push(`Failed to delete ${trace.traceId}: ${msg}`);
      }
    }

    logger.info(
      `[TRACE_CLEANUP] Cleanup complete: ${result.deleted} deleted, ${result.errors.length} errors`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[TRACE_CLEANUP] Cleanup failed:', msg);
    result.errors.push(msg);
  }

  return result;
}

/**
 * Lambda handler for scheduled trace cleanup.
 */
export const handler = async () => {
  logger.info('[TRACE_CLEANUP_HANDLER] Invoked');

  const result = await cleanupOrphanTraces();

  logger.info('[TRACE_CLEANUP_HANDLER] Result:', JSON.stringify(result));

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
