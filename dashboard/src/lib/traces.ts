/* eslint-disable @typescript-eslint/no-explicit-any */
import { getResourceName } from '@/lib/sst-utils';
import { decodePaginationToken, encodePaginationToken } from '@/lib/pagination-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { TraceSource } from '@claw/core/lib/types/index';
import { Trace } from '@/lib/types/ui';

/**
 * Fetches trace summaries from DynamoDB.
 */
export async function getTraces(
  nextToken?: string,
  injectedDocClient?: any
): Promise<{ items: Trace[]; nextToken: string | undefined }> {
  try {
    const tableName = getResourceName('TraceTable');
    if (!tableName) {
      console.warn('TraceTable name is missing from Resources and Environment');
      return { items: [], nextToken: undefined };
    }
    const client = new DynamoDBClient({});
    const docClient = injectedDocClient ?? DynamoDBDocumentClient.from(client);

    const queryRes = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'SummaryByNode',
        KeyConditionExpression: 'nodeId = :summary',
        ExpressionAttributeValues: { ':summary': '__summary__' },
        Limit: 100,
        ExclusiveStartKey: decodePaginationToken(nextToken ?? ''),
        ScanIndexForward: false,
      })
    );

    const summaryItems = queryRes.Items ?? [];
    const allItems = summaryItems.sort((a: any, b: any) => {
      const bTs = Number(b.timestamp);
      const aTs = Number(a.timestamp);
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });

    const filteredSummary = allItems.filter(
      (item: any) => item.source !== TraceSource.SYSTEM
    ) as Trace[];

    // Fallback path: if trace summaries are disabled, '__summary__' rows won't exist.
    // In that case, scan root trace nodes so /trace still has data.
    if (filteredSummary.length === 0) {
      console.warn(
        '[getTraces] No summary rows found. Falling back to root trace scan (trace_summaries may be disabled).'
      );

      const scanRes = await docClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'nodeId = :root',
          ExpressionAttributeValues: { ':root': 'root' },
          Limit: 200,
          ExclusiveStartKey: decodePaginationToken(nextToken ?? ''),
        })
      );

      const fallbackItems = (scanRes.Items ?? [])
        .filter((item: any) => item.source !== TraceSource.SYSTEM)
        .sort((a: any, b: any) => {
          const bTs = Number(b.timestamp);
          const aTs = Number(a.timestamp);
          return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
        }) as Trace[];

      return {
        items: fallbackItems,
        nextToken: encodePaginationToken(scanRes.LastEvaluatedKey),
      };
    }

    return {
      items: filteredSummary,
      nextToken: encodePaginationToken(queryRes.LastEvaluatedKey),
    };
  } catch (e) {
    console.error('Error fetching traces:', e);
    return { items: [], nextToken: undefined };
  }
}
