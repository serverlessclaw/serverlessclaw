import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getResourceName } from '@/lib/sst-utils';
import { logger } from '@claw/core/lib/logger';
import { getUserId } from '@/lib/auth-utils';

/**
 * GET /api/chat/context?sessionId=...
 * Returns recent traces and memory fragments for a specific session.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const userId = getUserId(req);

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const tableName = getResourceName('TraceTable');
    if (!tableName) {
      return NextResponse.json({ traces: [], memory: [] });
    }

    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    // 1. Fetch recent traces for this user and filter by sessionId
    // NOTE: This uses the UserIndex and filters in-memory for the session.
    // In a high-scale environment, a SessionIndex (GSI) would be better.
    const traceRes = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'UserIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        Limit: 50,
        ScanIndexForward: false, // Recent first
      })
    );

    const sessionTraces = (traceRes.Items || [])
      .filter((item: Record<string, unknown>) => {
        const initialContext = item.initialContext as Record<string, unknown> | undefined;
        return initialContext?.sessionId === sessionId || item.sessionId === sessionId;
      })
      .slice(0, 5); // Just show the most recent 5 relevant flows in context

    // 2. Fetch memory fragments for this session
    // We search for "SESSIONS#<userId>#<sessionId>" in memory
    // TODO: Implement getMemoryReserveBySession in IMemory
    const reserveItems: unknown[] = [];

    return NextResponse.json({
      traces: sessionTraces,
      memory: reserveItems.slice(0, 10),
    });
  } catch (error) {
    logger.error('[Context API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
