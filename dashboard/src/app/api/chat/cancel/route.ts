import { NextRequest, NextResponse } from 'next/server';
import { EventType } from '@claw/core/lib/types/agent';
import { emitEvent, EventPriority } from '@claw/core/lib/utils/bus';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';

/**
 * Endpoint to cancel an active task/trace.
 *
 * @param req - The incoming POST request with traceId and optional reason.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { traceId, reason } = await req.json();
    const userId = 'dashboard-user';

    if (!traceId) {
      return NextResponse.json({ error: 'Missing traceId' }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    logger.info(`[Cancel API] Cancelling task: ${traceId}, reason: ${reason}`);

    await emitEvent(
      'dashboard.api.cancel',
      EventType.TASK_CANCELLED,
      {
        userId,
        taskId: traceId, // Use traceId as the root taskId for cancellation
        initiatorId: 'dashboard-user',
        reason: reason || 'Cancelled by user from dashboard',
      },
      { priority: EventPriority.HIGH }
    );

    return NextResponse.json({ success: true, traceId });
  } catch (error) {
    logger.error('[Cancel API] Failed to cancel task:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
