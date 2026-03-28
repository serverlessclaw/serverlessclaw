import { EventType } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/health';
import { Context } from 'aws-lambda';

/**
 * Main entry point for the Events Handler.
 * Routes different EventBridge event types to specialized handlers via dynamic imports.
 * Dynamic imports are used to reduce import depth and improve AI signal clarity for the main entry point.
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
    const { emitMetrics, METRICS } = await import('../lib/metrics');
    emitMetrics([METRICS.agentInvoked(detailType)]).catch((err) =>
      logger.warn(`Metrics emission failed for ${detailType}:`, err)
    );
  } catch {
    // metrics module may not be available in all environments
  }

  const userId = (eventDetail.userId as string) ?? 'SYSTEM';
  const traceId = (eventDetail.traceId as string) ?? 'unknown';

  try {
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

      case EventType.CLARIFICATION_TIMEOUT: {
        const { handleClarificationTimeout } =
          await import('./events/clarification-timeout-handler');
        await handleClarificationTimeout(eventDetail);
        break;
      }

      case EventType.PARALLEL_TASK_DISPATCH: {
        const { handleParallelDispatch } = await import('./events/parallel-handler');
        await handleParallelDispatch(
          event as unknown as import('aws-lambda').EventBridgeEvent<
            string,
            import('./events/parallel-handler').ParallelTaskEvent
          >
        );
        break;
      }

      case EventType.PARALLEL_BARRIER_TIMEOUT: {
        const { handleParallelBarrierTimeout } =
          await import('./events/parallel-barrier-timeout-handler');
        await handleParallelBarrierTimeout(eventDetail);
        break;
      }

      case EventType.PARALLEL_TASK_COMPLETED: {
        const { handleParallelTaskCompleted } =
          await import('./events/parallel-task-completed-handler');
        await handleParallelTaskCompleted(eventDetail);
        break;
      }

      case EventType.TASK_CANCELLED: {
        const { handleTaskCancellation } = await import('./events/cancellation-handler');
        await handleTaskCancellation(
          event as unknown as import('aws-lambda').EventBridgeEvent<
            string,
            import('../lib/agent/schema').TaskCancellation
          >
        );
        break;
      }

      case EventType.HEARTBEAT_PROACTIVE: {
        const { handleProactiveHeartbeat } = await import('./events/proactive-handler');
        await handleProactiveHeartbeat(eventDetail, context);
        break;
      }

      case EventType.ESCALATION_LEVEL_TIMEOUT: {
        const { handleEscalationLevelTimeout } = await import('./events/escalation-handler');
        await handleEscalationLevelTimeout(eventDetail);
        break;
      }

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
