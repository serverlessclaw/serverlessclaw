/**
 * Conflict Resolution Utilities
 * Implements tie-break timeout enforcement for multi-party collaborations
 */

import { logger } from './logger';
import { getConfigValue } from './config';

export interface ConflictResolutionState {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  conflictingParties: string[];
  status: 'active' | 'timeout' | 'resolved';
}

/**
 * Check if a conflict has exceeded the tie-break timeout
 * @param startedAt - Timestamp when the conflict started (ms)
 * @returns true if timeout exceeded
 */
export async function isConflictTimedOut(startedAt: number): Promise<boolean> {
  const timeoutMs = getConfigValue('TIE_BREAK_TIMEOUT_MS');
  return Date.now() - startedAt > timeoutMs;
}

/**
 * Get remaining time before conflict times out
 * @param startedAt - Timestamp when the conflict started (ms)
 * @returns Remaining milliseconds, or 0 if already timed out
 */
export async function getConflictRemainingTime(startedAt: number): Promise<number> {
  const timeoutMs = getConfigValue('TIE_BREAK_TIMEOUT_MS');
  const remaining = timeoutMs - (Date.now() - startedAt);
  return Math.max(0, remaining);
}

/**
 * Helper to emit an event with exponential backoff retry for reliability
 */
async function emitEventWithRetry(
  source: string,
  eventType: any,
  payload: any,
  traceId: string
): Promise<void> {
  const { emitEvent } = await import('./utils/bus');
  const { getConfigValue: getEBConfig } = await import('./config');

  const maxRetries = getEBConfig('EB_MAX_RETRIES') ?? 3;
  const initialBackoff = getEBConfig('EB_INITIAL_BACKOFF_MS') ?? 100;

  let attempt = 0;
  while (true) {
    try {
      await emitEvent(source, eventType, {
        ...payload,
        traceId,
      });
      return;
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        logger.error(
          `[CONFLICT_RESOLUTION] Failed to emit ${eventType} after ${maxRetries} retries:`,
          err
        );
        throw err;
      }
      const backoff = initialBackoff * Math.pow(2, attempt - 1);
      logger.warn(
        `[CONFLICT_RESOLUTION] Emit ${eventType} failed (attempt ${attempt}/${maxRetries}), retrying in ${backoff}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

/**
 * Emit timeout event for conflict resolution
 * Called when tie-break timeout is exceeded
 */
export async function emitConflictTimeoutEvent(sessionId: string, traceId: string): Promise<void> {
  const { EventType } = await import('./types/agent');

  await emitEventWithRetry(
    'facilitator',
    EventType.STRATEGIC_TIE_BREAK,
    {
      userId: sessionId,
      agentId: 'facilitator',
      task: 'conflict-resolution-timeout',
      error: `Tie-break timeout exceeded for session ${sessionId}. Performing strategic tie-break.`,
      sessionId,
      initiatorId: 'facilitator',
      metadata: {
        timeoutMs: getConfigValue('TIE_BREAK_TIMEOUT_MS'),
        timestamp: Date.now(),
      },
    },
    traceId
  );

  logger.warn(
    `[CONFLICT_RESOLUTION] Timeout exceeded for session ${sessionId}, triggering tie-break`
  );
}

/**
 * Check collaboration timeout and emit events if exceeded
 * @param collaboration - The collaboration object with timeoutMs field
 * @param traceId - Trace ID for the operation
 */
export async function checkCollaborationTimeout(
  collaboration: {
    sessionId: string;
    lastActivityAt: number;
    timeoutMs?: number;
    userId?: string;
    task?: string;
    agentId?: string;
  },
  traceId: string
): Promise<boolean> {
  const timeoutMs = collaboration.timeoutMs ?? getConfigValue('TIE_BREAK_TIMEOUT_MS');
  const elapsed = Date.now() - collaboration.lastActivityAt;

  if (elapsed > timeoutMs) {
    logger.warn(
      `[COLLABORATION] Session ${collaboration.sessionId} has exceeded timeout ` +
        `(${elapsed}ms > ${timeoutMs}ms). Triggering strategic tie-break.`
    );

    const { EventType } = await import('./types/agent');

    await emitEventWithRetry(
      'facilitator',
      EventType.STRATEGIC_TIE_BREAK,
      {
        userId: collaboration.userId || collaboration.sessionId,
        agentId: collaboration.agentId || 'facilitator',
        task: collaboration.task || 'Collaboration Timeout',
        originalTask: collaboration.task || 'unknown',
        sessionId: collaboration.sessionId,
        initiatorId: 'system.supervisor',
        depth: 0,
        metadata: {
          timeoutMs,
          elapsedMs: elapsed,
          timestamp: Date.now(),
        },
      },
      traceId
    );

    return true;
  }

  return false;
}
