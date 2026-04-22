/* eslint-disable @typescript-eslint/no-explicit-any */
import { getResourceName } from '@/lib/sst-utils';
import { decodePaginationToken, encodePaginationToken } from '@/lib/pagination-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TraceSource } from '@claw/core/lib/types/index';
import { Trace } from '@/lib/types/ui';
import { logger } from '@claw/core/lib/logger';

/**
 * Fetches trace summaries from DynamoDB.
 */
export async function getTraces(
  nextToken?: string,
  options?: { startTime?: number; endTime?: number },
  injectedDocClient?: any
): Promise<{ items: Trace[]; nextToken: string | undefined }> {
  try {
    const tableName = getResourceName('TraceTable');
    if (!tableName) {
      logger.warn('TraceTable name is missing from Resources and Environment');
      return { items: [], nextToken: undefined };
    }
    const client = new DynamoDBClient({});
    const docClient = injectedDocClient ?? DynamoDBDocumentClient.from(client);

    const { startTime, endTime } = options ?? {};
    let keyCondition = 'nodeId = :summary';
    const expressionAttributeValues: Record<string, any> = { ':summary': '__summary__' };

    if (startTime && endTime) {
      keyCondition += ' AND #ts BETWEEN :start AND :end';
      expressionAttributeValues[':start'] = startTime;
      expressionAttributeValues[':end'] = endTime;
    } else if (startTime) {
      keyCondition += ' AND #ts >= :start';
      expressionAttributeValues[':start'] = startTime;
    } else if (endTime) {
      keyCondition += ' AND #ts <= :end';
      expressionAttributeValues[':end'] = endTime;
    }

    const queryRes = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'SummaryByNode',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: startTime || endTime ? { '#ts': 'timestamp' } : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
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
    // In that case, query root trace nodes so /trace still has data.
    if (filteredSummary.length === 0) {
      logger.warn(
        '[getTraces] No summary rows found. Falling back to root trace query (trace_summaries may be disabled).'
      );

      // Re-use query logic but for 'root' nodeId
      const rootExpressionAttributeValues = { ...expressionAttributeValues, ':summary': 'root' };

      const fallbackRes = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'SummaryByNode',
          KeyConditionExpression: keyCondition,
          ExpressionAttributeNames: startTime || endTime ? { '#ts': 'timestamp' } : undefined,
          ExpressionAttributeValues: rootExpressionAttributeValues,
          Limit: 100,
          ExclusiveStartKey: decodePaginationToken(nextToken ?? ''),
          ScanIndexForward: false,
        })
      );

      const fallbackItems = (fallbackRes.Items ?? [])
        .filter((item: any) => item.source !== TraceSource.SYSTEM)
        .sort((a: any, b: any) => {
          const bTs = Number(b.timestamp);
          const aTs = Number(a.timestamp);
          return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
        }) as Trace[];

      return {
        items: fallbackItems,
        nextToken: encodePaginationToken(fallbackRes.LastEvaluatedKey),
      };
    }

    return {
      items: filteredSummary,
      nextToken: encodePaginationToken(queryRes.LastEvaluatedKey),
    };
  } catch (e) {
    logger.error('Error fetching traces:', e);
    return { items: [], nextToken: undefined };
  }
}
