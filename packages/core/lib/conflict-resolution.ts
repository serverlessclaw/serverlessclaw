/**
 * Conflict Resolution Utilities
 * Implements tie-break timeout enforcement for multi-party collaborations
 */

import { logger } from './logger';
import { getDynamicConfigValue } from './config';

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
  const timeoutMs = await getDynamicConfigValue('TIE_BREAK_TIMEOUT_MS');
  return Date.now() - startedAt > timeoutMs;
}

/**
 * Get remaining time before conflict times out
 * @param startedAt - Timestamp when the conflict started (ms)
 * @returns Remaining milliseconds, or 0 if already timed out
 */
export async function getConflictRemainingTime(startedAt: number): Promise<number> {
  const timeoutMs = await getDynamicConfigValue('TIE_BREAK_TIMEOUT_MS');
  const remaining = timeoutMs - (Date.now() - startedAt);
  return Math.max(0, remaining);
}

/**
 * Helper to emit an event using the unified bus, which handles retries and DLQ.
 * Implements Principle 10 (Lean Evolution) by delegating to core utilities.
 */
async function emitEventWithRetry(
  source: string,
  eventType: import('./types/agent').EventType,
  payload: Record<string, unknown>,
  traceId: string
): Promise<void> {
  const { emitEvent } = await import('./utils/bus');
  const { getConfigValue: getEBConfig } = await import('./config');

  const maxRetries = getEBConfig('EB_MAX_RETRIES') ?? 3;

  const result = await emitEvent(
    source,
    eventType,
    { ...payload, traceId },
    {
      maxRetries,
      correlationId: traceId,
    }
  );

  if (!result.success && result.reason !== 'DLQ') {
    logger.error(`[CONFLICT_RESOLUTION] Failed to emit ${eventType}: ${result.reason}`);
    throw new Error(`Event emission failed: ${result.reason}`);
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
        timeoutMs: await getDynamicConfigValue('TIE_BREAK_TIMEOUT_MS'),
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
    workspaceId?: string;
  },
  traceId: string
): Promise<boolean> {
  const timeoutMs =
    collaboration.timeoutMs ?? (await getDynamicConfigValue('TIE_BREAK_TIMEOUT_MS'));
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
        workspaceId: collaboration.workspaceId,
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
