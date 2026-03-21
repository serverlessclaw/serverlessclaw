import { EventType } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
// Sub-handlers are imported lazily per-event to minimise static import depth and context budget.

/**
 * Main entry point for the Events Handler.
 * Routes different EventBridge event types to specialized handlers.
 *
 * @param event - The EventBridge event containing detail-type and detail.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves when the event has been processed.
 */
export async function handler(
  event: {
    'detail-type': string;
    detail: Record<string, unknown>;
  },
  context: Context
): Promise<void> {
  const detailType = event['detail-type'];
  const eventDetail = event.detail;

  console.log(`[EVENTS] Received: ${detailType} | Session: ${eventDetail.sessionId ?? 'N/A'}`);
  logger.info('EventHandler received event:', JSON.stringify(event, null, 2));

  switch (detailType) {
    case EventType.SYSTEM_BUILD_FAILED: {
      const { handleBuildFailure } = await import('./events/build-handler');
      await handleBuildFailure(eventDetail, context);
      break;
    }

    case EventType.SYSTEM_BUILD_SUCCESS: {
      const { handleBuildSuccess } = await import('./events/build-handler');
      await handleBuildSuccess(eventDetail);
      break;
    }

    case EventType.CONTINUATION_TASK: {
      const { handleContinuationTask } = await import('./events/continuation-handler');
      await handleContinuationTask(eventDetail, context);
      break;
    }

    case EventType.SYSTEM_HEALTH_REPORT: {
      const { handleHealthReport } = await import('./events/health-handler');
      await handleHealthReport(eventDetail, context);
      break;
    }

    case EventType.TASK_COMPLETED:
    case EventType.TASK_FAILED: {
      const { handleTaskResult } = await import('./events/task-result-handler');
      await handleTaskResult(eventDetail, detailType);
      break;
    }

    case EventType.CLARIFICATION_REQUEST: {
      const { handleClarificationRequest } = await import('./events/clarification-handler');
      await handleClarificationRequest(eventDetail);
      break;
    }

    case EventType.HEARTBEAT_PROACTIVE: {
      const { handleProactiveHeartbeat } = await import('./events/proactive-handler');
      await handleProactiveHeartbeat(eventDetail, context);
      break;
    }

    default:
      logger.warn(`Unhandled event type: ${detailType}`);
  }
}
