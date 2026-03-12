import { NextRequest, NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SSTResource } from '@claw/core/lib/types/index';
import { revalidatePath } from 'next/cache';

/**
 * Handles trace deletion (single or all) with robust throttling management
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const traceId = req.nextUrl.searchParams.get('traceId');

    if (!traceId) {
      return NextResponse.json({ error: 'Missing traceId' }, { status: 400 });
    }

    const typedResource = Resource as unknown as SSTResource;
    const tableName = typedResource.TraceTable?.name;
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
      let lastKey: Record<string, any> | undefined;
      
      try {
        do {
          const scanRes = await docClient.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: lastKey,
            Limit: 50 // Even smaller scan batches
          }));
          
          if (scanRes.Items && scanRes.Items.length > 0) {
            console.log(`[Trace API] Processing ${scanRes.Items.length} traces for deletion`);
            
            // Group into batches of 25 (DynamoDB limit for BatchWrite)
            for (let i = 0; i < scanRes.Items.length; i += 25) {
              const batch = scanRes.Items.slice(i, i + 25);
              let requestItems = {
                [tableName]: batch.map(item => ({
                  DeleteRequest: {
                    Key: { traceId: item.traceId }
                  }
                }))
              };

              // Retry loop for Throttling or UnprocessedItems
              let retries = 0;
              const maxRetries = 5;
              
              while (requestItems[tableName].length > 0 && retries < maxRetries) {
                try {
                  const result = await docClient.send(new BatchWriteCommand({
                    RequestItems: requestItems
                  }));
                  
                  // Update deletedCount for what actually worked
                  const attemptedCount = requestItems[tableName].length;
                  const unprocessedCount = result.UnprocessedItems?.[tableName]?.length || 0;
                  deletedCount += (attemptedCount - unprocessedCount);

                  // Set unprocessed items for the next retry attempt
                  if (unprocessedCount > 0) {
                    console.warn(`[Trace API] Retrying ${unprocessedCount} unprocessed items...`);
                    requestItems = result.UnprocessedItems as any;
                    retries++;
                    await new Promise(r => setTimeout(r, Math.pow(2, retries) * 100)); // Exponential backoff
                  } else {
                    requestItems[tableName] = []; // All done
                  }
                } catch (err: any) {
                  if (err.name === 'ThrottlingException' || err.__type?.includes('ThrottlingException')) {
                    console.warn(`[Trace API] Throttled. Retrying attempt ${retries + 1}...`);
                    retries++;
                    await new Promise(r => setTimeout(r, Math.pow(2, retries) * 200)); // More aggressive backoff
                  } else {
                    throw err; // Real error
                  }
                }
              }

              if (retries >= maxRetries && requestItems[tableName].length > 0) {
                 console.error('[Trace API] Max retries reached for batch. Skipping remaining items in this chunk.');
              }

              // Constant delay between batches to keep throughput smooth
              await new Promise(resolve => setTimeout(resolve, 250));
            }
          }
          lastKey = scanRes.LastEvaluatedKey;
        } while (lastKey);

        console.log(`[Trace API] Successfully purged ${deletedCount} traces`);
        revalidatePath('/trace');
        return NextResponse.json({ success: true, count: deletedCount });
      } catch (scanError: any) {
        console.error('[Trace API] Error during scan/delete loop:', scanError);
        throw scanError;
      }
    }

    console.log('[Trace API] Deleting single trace:', traceId);
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { traceId },
      })
    );

    revalidatePath('/trace');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Trace API] Critical failure:', error);
    const message = error?.message || String(error);
    return NextResponse.json({ 
      error: message, 
      details: error instanceof Error ? error.stack : undefined 
    }, { status: 500 });
  }
}
