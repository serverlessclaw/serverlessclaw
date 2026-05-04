import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../logger';
import { BUS } from '../../constants';
import { getEventBridge, getBusName } from './client';
import { reserveIdempotencyKey, commitIdempotencyKey } from './idempotency';
import { storeInDLQ, purgeDlqEntry } from './dlq';
import { EventOptions, EventPriority, ErrorCategory, DlqEntry, EventType } from './types';

const MAX_RETRIES = BUS.MAX_RETRIES;
const INITIAL_BACKOFF_MS = BUS.INITIAL_BACKOFF_MS;

function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('throttling') ||
      message.includes('rate limit') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('temporary') ||
      message.includes('service unavailable') ||
      message.includes('too many requests') ||
      message.includes('internal error') ||
      message.includes('500') ||
      message.includes('503') ||
      message.includes('socket') ||
      message.includes('econnreset') ||
      message.includes('etimedout')
    ) {
      return ErrorCategory.TRANSIENT;
    }
    if (
      message.includes('access denied') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('not found') ||
      message.includes('invalid') ||
      message.includes('malformed')
    ) {
      return ErrorCategory.PERMANENT;
    }
  }
  return ErrorCategory.UNKNOWN;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function emitEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: EventOptions = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  const {
    priority = EventPriority.NORMAL,
    idempotencyKey,
    maxRetries = MAX_RETRIES,
    correlationId,
  } = options;

  const workspaceId = (detail.workspaceId as string) || undefined;

  if (idempotencyKey) {
    const reserved = await reserveIdempotencyKey(idempotencyKey, workspaceId);
    if (!reserved) {
      logger.info(`Duplicate event detected: ${idempotencyKey}`);
      return { success: false, reason: 'DUPLICATE' };
    }
  }

  const busName = await getBusName();
  const detailJson = JSON.stringify(detail);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: source,
            DetailType: type,
            Detail: detailJson,
            EventBusName: busName,
          },
        ],
      });

      const result = await getEventBridge().send(command);

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        if (attempt < maxRetries) {
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
          continue;
        }
        await storeInDLQ(
          source,
          type as string,
          detail,
          {
            retryCount: attempt,
            maxRetries,
            lastError: `FailedEntryCount=${result.FailedEntryCount}`,
            priority,
            correlationId,
          },
          idempotencyKey
        );
        return { success: false, reason: 'DLQ' };
      }

      if (idempotencyKey) {
        await commitIdempotencyKey(idempotencyKey, result.Entries?.[0]?.EventId, workspaceId);
      }

      return { success: true, eventId: result.Entries?.[0]?.EventId };
    } catch (error) {
      const errorCategory = categorizeError(error);
      if (errorCategory === ErrorCategory.PERMANENT || attempt >= maxRetries) {
        await storeInDLQ(
          source,
          type as string,
          detail,
          {
            retryCount: attempt,
            maxRetries,
            lastError: error instanceof Error ? error.message : String(error),
            errorCategory,
            priority,
            correlationId,
          },
          idempotencyKey
        );
        return {
          success: false,
          reason: errorCategory === ErrorCategory.PERMANENT ? 'PERMANENT_ERROR' : 'DLQ',
        };
      }
      await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
    }
  }
  return { success: false, reason: 'MAX_RETRIES' };
}

export async function retryDlqEntry(entry: DlqEntry): Promise<boolean> {
  try {
    const detail = JSON.parse(entry.detail);
    const idempotencyKey = `dlq-retry:${entry.userId}:${entry.timestamp}`;
    const result = await emitEvent(entry.source, entry.detailType, detail, {
      priority: entry.priority as EventPriority,
      correlationId: entry.correlationId,
      maxRetries: 2,
      idempotencyKey,
    });
    if (result.success || result.reason === 'DUPLICATE') {
      await purgeDlqEntry(entry);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to retry DLQ entry:', error);
    return false;
  }
}

export async function emitEventWithIdempotency(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'idempotencyKey'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  if (!detail.traceId) {
    throw new Error('traceId is required for emitEventWithIdempotency');
  }
  const idempotencyKey = `${source}:${type}:${detail.sessionId ?? 'global'}:${detail.traceId}`;
  return emitEvent(source, type, detail, { ...options, idempotencyKey });
}

export async function emitCriticalEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'priority'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  return emitEvent(source, type, detail, {
    ...options,
    priority: EventPriority.CRITICAL,
    maxRetries: options.maxRetries ?? 5,
  });
}

export async function emitHighPriorityEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'priority'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  return emitEvent(source, type, detail, {
    ...options,
    priority: EventPriority.HIGH,
    maxRetries: options.maxRetries ?? 3,
  });
}

export async function emitLowPriorityEvent(
  source: string,
  type: EventType | string,
  detail: Record<string, unknown>,
  options: Omit<EventOptions, 'priority'> = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  return emitEvent(source, type, detail, {
    ...options,
    priority: EventPriority.LOW,
    maxRetries: options.maxRetries ?? 1,
  });
}
