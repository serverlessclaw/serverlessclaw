import { logger } from '../../lib/logger';
import { MetabolismService } from '../../lib/maintenance/metabolism';
import { BaseMemoryProvider } from '../../lib/memory';
import { FailureEventPayload } from '../../lib/schema/events';

/**
 * Handle immediate dashboard failure events for real-time remediation.
 * Triggered by ClawTracer.failTrace() when source === 'dashboard'.
 */
export async function handleDashboardFailure(
  payload: FailureEventPayload,
  _eventType: string
): Promise<void> {
  const { traceId, error, userId } = payload;
  logger.info(
    `[DashboardFailureHandler] Processing failure for trace ${traceId}: ${error} (User: ${userId})`
  );

  try {
    const memory = new BaseMemoryProvider();
    const result = await MetabolismService.remediateDashboardFailure(memory, payload);

    if (result) {
      logger.info(
        `[DashboardFailureHandler] Autonomous remediation successful for trace ${traceId}: ${result.actual}`
      );
    } else {
      logger.info(
        `[DashboardFailureHandler] Complex failure for trace ${traceId} - HITL remediation scheduled.`
      );
    }
  } catch (err) {
    logger.error(
      `[DashboardFailureHandler] Critical failure during remediation logic for trace ${traceId}:`,
      err
    );
    // Note: Do not throw here to avoid EventBridge retries for remediation logic itself
    // unless it's a transient failure that should be retried.
  }
}
