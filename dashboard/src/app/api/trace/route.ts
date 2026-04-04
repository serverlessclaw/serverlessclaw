import { NextRequest, NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { revalidatePath } from 'next/cache';

/**
 * Handles trace deletion (single or all) with robust throttling management
 *
 * @param req - The incoming DELETE request with traceId query parameter.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const traceId = req.nextUrl.searchParams.get('traceId');

    if (!traceId) {
      return NextResponse.json({ error: 'Missing traceId' }, { status: 400 });
    }

    const tableName = Resource.TraceTable.name;
    if (!tableName) {
      console.error('[Trace API] TraceTable not found in resources');
      return NextResponse.json({ error: 'TraceTable not found' }, { status: 500 });
    }

    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });

    if (traceId === 'all') {
      console.log('[Trace API] Purging all traces from table:', tableName);
      let deletedCount = 0;
      let lastKey: Record<string, unknown> | undefined;

      try {
        do {
          const scanRes = await docClient.send(
            new ScanCommand({
              TableName: tableName,
              ExclusiveStartKey: lastKey,
              Limit: 50, // Even smaller scan batches
            })
          );

          if (scanRes.Items && scanRes.Items.length > 0) {
            console.log(`[Trace API] Processing ${scanRes.Items.length} trace nodes for deletion`);

            // Group into batches of 25 (DynamoDB limit for BatchWrite)
            for (let i = 0; i < scanRes.Items.length; i += 25) {
              const batch = scanRes.Items.slice(i, i + 25);
              let requestItems = {
                [tableName]: batch.map((item) => ({
                  DeleteRequest: {
                    Key: { traceId: item.traceId, nodeId: item.nodeId },
                  },
                })),
              };

              // Retry loop for Throttling or UnprocessedItems
              let retries = 0;
              const maxRetries = 5;

              while (requestItems[tableName].length > 0 && retries < maxRetries) {
                try {
                  const result = await docClient.send(
                    new BatchWriteCommand({
                      RequestItems: requestItems,
                    })
                  );

                  // Update deletedCount for what actually worked
                  const attemptedCount = requestItems[tableName].length;
                  const unprocessedCount = result.UnprocessedItems?.[tableName]?.length ?? 0;
                  deletedCount += attemptedCount - unprocessedCount;

                  // Set unprocessed items for the next retry attempt
                  if (unprocessedCount > 0) {
                    console.warn(`[Trace API] Retrying ${unprocessedCount} unprocessed items...`);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    requestItems = result.UnprocessedItems as Record<string, any>;
                    retries++;
                    await new Promise((r) => setTimeout(r, Math.pow(2, retries) * 100)); // Exponential backoff
                  } else {
                    requestItems[tableName] = []; // All done
                  }
                } catch (err: unknown) {
                  const errorMsg = err instanceof Error ? err.name : String(err);
                  if (
                    errorMsg === 'ThrottlingException' ||
                    (err as { __type?: string }).__type?.includes('ThrottlingException')
                  ) {
                    console.warn(`[Trace API] Throttled. Retrying attempt ${retries + 1}...`);
                    retries++;
                    await new Promise((r) => setTimeout(r, Math.pow(2, retries) * 200)); // More aggressive backoff
                  } else {
                    throw err; // Real error
                  }
                }
              }

              if (retries >= maxRetries && requestItems[tableName].length > 0) {
                console.error(
                  '[Trace API] Max retries reached for batch. Skipping remaining items in this chunk.'
                );
              }

              // Constant delay between batches to keep throughput smooth
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
          lastKey = scanRes.LastEvaluatedKey;
        } while (lastKey);

        console.log(`[Trace API] Successfully purged ${deletedCount} trace nodes`);
        revalidatePath('/trace');
        return NextResponse.json({ success: true, count: deletedCount });
      } catch (scanError: unknown) {
        console.error('[Trace API] Error during scan/delete loop:', scanError);
        throw scanError;
      }
    }

    console.log('[Trace API] Deleting all nodes for trace:', traceId);

    // 1. Query all nodes for this traceId
    const { Items } = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'traceId = :tid',
        ExpressionAttributeValues: { ':tid': traceId },
        ProjectionExpression: 'traceId, nodeId',
      })
    );

    if (Items && Items.length > 0) {
      // 2. Delete all found nodes
      for (let i = 0; i < Items.length; i += 25) {
        const batch = Items.slice(i, i + 25);
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [tableName]: batch.map((item) => ({
                DeleteRequest: {
                  Key: { traceId: item.traceId, nodeId: item.nodeId },
                },
              })),
            },
          })
        );
      }
      console.log(`[Trace API] Successfully deleted ${Items.length} nodes for trace ${traceId}`);
    } else {
      console.warn(`[Trace API] No nodes found for traceId ${traceId}`);
    }

    revalidatePath('/trace');
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[Trace API] Critical failure:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: message,
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
