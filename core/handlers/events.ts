import { EventType } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/health';
import { Context } from 'aws-lambda';
import { handleBuildFailure, handleBuildSuccess } from './events/build-handler';
import { handleContinuationTask } from './events/continuation-handler';
import { handleHealthReport } from './events/health-handler';
import { handleTaskResult } from './events/task-result-handler';
import { handleClarificationRequest } from './events/clarification-handler';
import { handleClarificationTimeout } from './events/clarification-timeout-handler';
import { handleParallelDispatch } from './events/parallel-handler';
import { handleParallelBarrierTimeout } from './events/parallel-barrier-timeout-handler';
import { handleParallelTaskCompleted } from './events/parallel-task-completed-handler';
import { handleTaskCancellation } from './events/cancellation-handler';
import { handleProactiveHeartbeat } from './events/proactive-handler';

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

  try {
    const { emitMetrics, Metrics } = await import('../lib/metrics');
    emitMetrics([Metrics.agentInvoked(detailType)]).catch((err) =>
      logger.warn(`Metrics emission failed for ${detailType}:`, err)
    );
  } catch {
    // metrics module may not be available in all environments
  }

  const userId = (eventDetail.userId as string) ?? 'SYSTEM';
  const traceId = (eventDetail.traceId as string) ?? 'unknown';

  try {
    switch (detailType) {
      case EventType.SYSTEM_BUILD_FAILED:
        await handleBuildFailure(eventDetail, context);
        break;

      case EventType.SYSTEM_BUILD_SUCCESS:
        await handleBuildSuccess(eventDetail);
        break;

      case EventType.CONTINUATION_TASK:
        await handleContinuationTask(eventDetail, context);
        break;

      case EventType.SYSTEM_HEALTH_REPORT:
        await handleHealthReport(eventDetail, context);
        break;

      case EventType.TASK_COMPLETED:
      case EventType.TASK_FAILED:
        await handleTaskResult(eventDetail, detailType);
        break;

      case EventType.CLARIFICATION_REQUEST:
        await handleClarificationRequest(eventDetail);
        break;

      case EventType.CLARIFICATION_TIMEOUT:
        await handleClarificationTimeout(eventDetail);
        break;

      case EventType.PARALLEL_TASK_DISPATCH:
        await handleParallelDispatch(
          event as unknown as import('aws-lambda').EventBridgeEvent<
            string,
            import('./events/parallel-handler').ParallelTaskEvent
          >
        );
        break;

      case EventType.PARALLEL_BARRIER_TIMEOUT:
        await handleParallelBarrierTimeout(eventDetail);
        break;

      case EventType.PARALLEL_TASK_COMPLETED:
        await handleParallelTaskCompleted(eventDetail);
        break;

      case EventType.TASK_CANCELLED:
        await handleTaskCancellation(
          event as unknown as import('aws-lambda').EventBridgeEvent<
            string,
            import('../lib/agent/schema').TaskCancellation
          >
        );
        break;

      case EventType.HEARTBEAT_PROACTIVE:
        await handleProactiveHeartbeat(eventDetail, context);
        break;

      default:
        logger.warn(`Unhandled event type: ${detailType}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`EventHandler failed for ${detailType}: ${errorMessage}`, error);
    await reportHealthIssue({
      component: 'EventHandler',
      issue: `Failed to process event ${detailType}: ${errorMessage}`,
      severity: 'high',
      userId,
      traceId,
      context: { detailType },
    });
  }
}
