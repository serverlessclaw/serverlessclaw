import { logger } from '../lib/logger';
import { AgentRole, EventType, AGENT_TYPES } from '../lib/types/agent';

const MAX_REPLAY_ATTEMPTS = 3;

/**
 * Dead Letter Queue Handler for EventBridge failed events.
 * Processes failed events from the DLQ and provides replay capability.
 *
 * @param event - The SQS event containing failed EventBridge messages.
 * @param _context - The AWS Lambda context (unused).
 * @returns A promise that resolves when all messages have been processed.
 */
export async function handler(
  event: {
    Records: Array<{
      messageId: string;
      body: string;
      attributes: Record<string, unknown>;
      messageAttributes: Record<string, unknown>;
    }>;
  },
  _context: unknown
): Promise<void> {
  logger.info(`[DLQ] Processing ${event.Records.length} failed events`);

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const detailType = messageBody['detail-type'] || 'Unknown';
      const detail = messageBody.detail || {};
      const replayCount = (detail.replayCount as number) ?? 0;

      logger.warn(`[DLQ] Processing failed event: ${detailType} (replay #${replayCount + 1})`, {
        messageId: record.messageId,
        detailType,
        detail: JSON.stringify(detail).substring(0, 500),
      });

      if (replayCount >= MAX_REPLAY_ATTEMPTS) {
        logger.error(
          `[DLQ] Event ${detailType} exceeded max replay attempts (${MAX_REPLAY_ATTEMPTS}). Moving to permanent DLQ.`
        );
        const { reportHealthIssue } = await import('./events/shared');
        await reportHealthIssue({
          component: 'DLQHandler',
          issue: `Event permanently failed after ${MAX_REPLAY_ATTEMPTS} replay attempts: ${detailType}`,
          severity: 'critical',
          userId: (detail.userId as string) ?? 'SYSTEM',
          traceId: (detail.traceId as string) ?? 'unknown',
          context: { envelopeId: record.messageId, originalDetailType: detailType },
        });
        continue;
      }

      const { emitTypedEvent } = await import('../lib/utils/typed-emit');
      const sourceAgent = (detail.sourceAgent as AgentRole) || AGENT_TYPES.SUPERCLAW;

      await emitTypedEvent(sourceAgent, detailType as EventType, {
        ...detail,
        replayCount: replayCount + 1,
      });

      logger.info(`[DLQ] Successfully replayed event: ${detailType} (attempt ${replayCount + 1})`, {
        messageId: record.messageId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[DLQ] Failed to process message ${record.messageId}: ${errorMessage}`, {
        error,
        messageBody: record.body,
      });
    }
  }

  logger.info(`[DLQ] Completed processing ${event.Records.length} events`);
}
