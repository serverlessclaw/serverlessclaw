import { NextResponse } from 'next/server';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';
import { BaseMemoryProvider } from '@claw/core/lib/memory/base';
import { EvolutionScheduler, PendingEvolution } from '@claw/core/lib/safety/evolution-scheduler';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function getWorkspaceId(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get('workspaceId')?.value || 'default';
}

/**
 * GET handler to list pending evolutions.
 */
export async function GET() {
  try {
    const memory = new BaseMemoryProvider();
    const workspaceId = await getWorkspaceId();

    // Using the same IndexName from EvolutionScheduler's triggerTimedOutActions
    // but without the expiresAt filter because we want all pending actions
    const items = await memory.queryItems({
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#tp = :type',
      FilterExpression:
        '#status = :pending AND (attribute_not_exists(workspaceId) OR workspaceId = :workspaceId)',
      ExpressionAttributeNames: {
        '#tp': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'PENDING_EVOLUTION',
        ':pending': 'pending',
        ':workspaceId': workspaceId,
      },
    });

    const pendingActions = items as unknown as PendingEvolution[];
    return NextResponse.json(pendingActions);
  } catch (error) {
    logger.error('Failed to fetch pending evolutions:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch pending evolutions',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * PATCH handler to approve or reject a pending evolution.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { actionId, status } = body;

    if (!actionId || !status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const memory = new BaseMemoryProvider();
    const scheduler = new EvolutionScheduler(memory);
    const workspaceId = await getWorkspaceId();

    await scheduler.updateStatus(actionId, status, workspaceId);

    return NextResponse.json({ success: true, actionId, status });
  } catch (error) {
    logger.error('Failed to update pending evolution:', error);
    return NextResponse.json(
      {
        error: 'Failed to update pending evolution',
        details: error instanceof Error ? error.message : String(error),
      },
      {
        status:
          error instanceof Error && error.message === 'Unauthorized access to pending evolution'
            ? HTTP_STATUS.FORBIDDEN
            : HTTP_STATUS.INTERNAL_SERVER_ERROR,
      }
    );
  }
}
