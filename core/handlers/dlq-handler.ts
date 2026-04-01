import { logger } from '../lib/logger';
import { EventType, AgentType } from '../lib/types/agent';

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

      logger.warn(`[DLQ] Processing failed event: ${detailType}`, {
        messageId: record.messageId,
        detailType,
        detail: JSON.stringify(detail).substring(0, 500),
      });

      // B3: Replay the failed event by re-emitting to the event bus
      // This allows the system to recover from transient failures
      const { emitTypedEvent } = await import('../lib/utils/typed-emit');

      // Extract the source agent from the detail if available
      const sourceAgent = (detail.sourceAgent as AgentType) || AgentType.SUPERCLAW;

      // Re-emit the event to retry processing
      await emitTypedEvent(sourceAgent, detailType as EventType, detail);

      logger.info(`[DLQ] Successfully replayed event: ${detailType}`, {
        messageId: record.messageId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[DLQ] Failed to process message ${record.messageId}: ${errorMessage}`, {
        error,
        messageBody: record.body,
      });

      // If replay fails, the message will return to the DLQ for manual inspection
      // This prevents infinite retry loops
    }
  }

  logger.info(`[DLQ] Completed processing ${event.Records.length} events`);
}
