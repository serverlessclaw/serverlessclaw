import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/lifecycle/health';

/**
 * Route an unhandled or failed event to the Dead Letter Queue for retry.
 */
export async function routeToDlq(
  event: { 'detail-type': string; detail: Record<string, unknown>; id?: string },
  detailType: string,
  userId: string,
  traceId: string,
  errorMessage?: string,
  sessionId?: string,
  workspaceId?: string
): Promise<void> {
  const { emitEvent } = await import('../lib/utils/bus');
  const { EventType } = await import('../lib/types/agent');

  if (detailType === EventType.DLQ_ROUTE) {
    logger.error(
      `[EVENTS] Prevented recursive DLQ routing for detailType=dlq_route (traceId: ${traceId})`
    );
    await reportHealthIssue({
      component: 'EventHandler',
      issue: 'Prevented recursive DLQ_ROUTE self-routing loop',
      severity: 'high',
      userId,
      traceId,
      workspaceId,
      context: {
        detailType,
        sessionId: sessionId || (event.detail.sessionId as string) || 'system-spine',
        errorMessage,
      },
    });
    return;
  }

  try {
    await emitEvent('events.handler', EventType.DLQ_ROUTE, {
      eventCategory: 'dlq_routing',
      detailType,
      originalEvent: event.detail,
      envelopeId: event.id,
      userId,
      traceId,
      sessionId: sessionId || (event.detail.sessionId as string) || 'system-spine',
      errorMessage,
      retryCount: (event.detail.retryCount as number) ?? 0,
      timestamp: Date.now(),
      workspaceId,
      observability: {
        detailType,
        envelopeId: event.id,
        userId,
        traceId,
        sessionId: sessionId || (event.detail.sessionId as string) || 'system-spine',
        errorMessage,
        retryCount: (event.detail.retryCount as number) ?? 0,
        timestamp: Date.now(),
        workspaceId,
      },
    });
    logger.info(`[EVENTS] Event ${detailType} routed to DLQ for retry`, {
      detailType,
      workspaceId: workspaceId || 'GLOBAL',
      timestamp: Date.now(),
    });
  } catch (dlqError) {
    // DLQ routing failed - report health issue but don't block
    logger.error(`[EVENTS] Failed to route to DLQ:`, dlqError);
    await reportHealthIssue({
      component: 'EventHandler',
      issue: `Failed to route unhandled event to DLQ: ${detailType}`,
      severity: 'high',
      userId,
      traceId,
      workspaceId,
      context: { detailType, dlqError: String(dlqError) },
    });
    throw new Error(`Unhandled event type: ${detailType}`);
  }
}
