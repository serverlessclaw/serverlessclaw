/* eslint-disable @typescript-eslint/no-explicit-any */
import { getResourceName } from '@/lib/sst-utils';
import { decodePaginationToken, encodePaginationToken } from '@/lib/pagination-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

    const allItems = (queryRes.Items ?? []).sort((a: any, b: any) => {
      const bTs = Number(b.timestamp);
      const aTs = Number(a.timestamp);
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });

    const filtered = allItems.filter((item: any) => item.source !== TraceSource.SYSTEM) as Trace[];
    const encodedNext = encodePaginationToken(queryRes.LastEvaluatedKey);

    return { items: filtered, nextToken: encodedNext };
  } catch (e) {
    console.error('Error fetching traces:', e);
    return { items: [], nextToken: undefined };
  }
}
