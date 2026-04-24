import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTraceTableName } from '../lib/utils/ddb-client';
import { logger } from '../lib/logger';

const docClient = getDocClient();
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

  const tableName = getTraceTableName();
  if (!tableName) {
    logger.error('[TRACE_CLEANUP] TraceTable name not found.');
    result.errors.push('TraceTable not found');
    return result;
  }

  logger.info(
    `[TRACE_CLEANUP] Starting orphan trace cleanup (threshold: ${threshold}, table: ${tableName})`
  );

  try {
    // Find traces with STARTED status and old timestamp
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status AND #ts < :threshold',
        ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
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

    // Delete each orphan trace (delete entire partition for the traceId so
    // both node-level items and the per-trace summary row are removed).
    for (const trace of orphanTraces) {
      try {
        if (trace.nodeId === '__summary__') {
          // Query for all nodes in this trace and delete them.
          const nodes = await docClient.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: 'traceId = :tid',
              ExpressionAttributeValues: { ':tid': trace.traceId },
              Limit: MAX_ITEMS_TO_SCAN,
            })
          );
          const items = nodes.Items ?? [];
          for (const node of items) {
            try {
              await docClient.send(
                new DeleteCommand({
                  TableName: tableName,
                  Key: { traceId: node.traceId, nodeId: node.nodeId },
                })
              );
              result.deleted++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(
                `[TRACE_CLEANUP] Failed to delete node ${node.nodeId} of ${node.traceId}: ${msg}`
              );
              result.errors.push(`Failed to delete ${node.traceId}/${node.nodeId}: ${msg}`);
            }
          }
        } else {
          // Delete the specific node and attempt to remove the summary row as well.
          await docClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: { traceId: trace.traceId, nodeId: trace.nodeId },
            })
          );
          result.deleted++;

          try {
            await docClient.send(
              new DeleteCommand({
                TableName: tableName,
                Key: { traceId: trace.traceId, nodeId: '__summary__' },
              })
            );
            result.deleted++;
          } catch {
            // summary may not exist; ignore
          }
        }
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
