import { NextRequest, NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { HTTP_STATUS } from '@claw/core/lib/constants';

/**
 * GET: Lists all active distributed locks.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const tableName = (Resource as unknown as { MemoryTable?: { name: string } }).MemoryTable?.name;
    if (!tableName) {
      return NextResponse.json(
        { error: 'MemoryTable not found' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }

    const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: { ':prefix': 'LOCK#' },
      })
    );

    const locks = (Items ?? [])
      .map((item) => ({
        lockId: item.userId.replace('LOCK#', ''),
        rawId: item.userId,
        expiresAt: item.expiresAt,
        acquiredAt: item.acquiredAt,
        timestamp: item.timestamp,
        isExpired: item.expiresAt < Math.floor(Date.now() / 1000),
      }))
      .sort((a, b) => b.acquiredAt - a.acquiredAt);

    return NextResponse.json({ locks });
  } catch (error) {
    console.error('Error fetching locks:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch locks',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * DELETE: Force-releases a specific lock.
 *
 * @param req - The incoming DELETE request with lock details.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const tableName = (Resource as unknown as { MemoryTable?: { name: string } }).MemoryTable?.name;
    if (!tableName) {
      return NextResponse.json(
        { error: 'MemoryTable not found' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }

    const rawId = req.nextUrl.searchParams.get('lockId');
    if (!rawId) {
      return NextResponse.json(
        { error: 'Missing lockId parameter' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { userId: rawId, timestamp: 0 },
      })
    );

    return NextResponse.json({ success: true, lockId: rawId });
  } catch (error) {
    console.error('Error releasing lock:', error);
    return NextResponse.json(
      {
        error: 'Failed to release lock',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
