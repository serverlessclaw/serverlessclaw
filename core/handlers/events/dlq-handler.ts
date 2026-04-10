import { logger } from '../../lib/logger';
import { reportHealthIssue } from '../../lib/lifecycle/health';

/**
 * Handles explicit DLQ_ROUTE events, which are generated when the Events Lambda
 * encounters an unhandled or failing event type.
 *
 * @param detail - The extracted event payload.
 * @param eventType - The type of event (DLQ_ROUTE).
 */
export async function handleDlqRoute(
  detail: Record<string, unknown>,
  _eventType: string
): Promise<void> {
  const originalEvent = detail.originalEvent as Record<string, unknown>;
  const detailType = detail.detailType as string;
  const envelopeId = detail.envelopeId as string;
  const errorMessage = detail.errorMessage as string;
  const userId = (detail.userId as string) || 'SYSTEM';
  const traceId = (detail.traceId as string) || 'unknown';

  logger.error(`[DLQ_ROUTE] Received unhandled or failed event: ${detailType}`, {
    envelopeId,
    errorMessage,
    originalEvent: JSON.stringify(originalEvent).substring(0, 500), // Log preview
  });

  // Report the issue so it shows up in dashboards
  await reportHealthIssue({
    component: 'EventHandler',
    issue: `Routed event to DLQ: ${detailType} - ${errorMessage || 'Unhandled event type'}`,
    severity: 'high',
    userId,
    traceId,
    context: {
      envelopeId,
      originalEvent,
      routeReason: errorMessage,
    },
  });

  // Here, one could potentially store the payload in a DynamoDB DLQ table or
  // send it to an SQS DLQ for manual inspection/replay. For now, we rely on
  // the EventBridge DLQ and Health Issues dashboard.
}
