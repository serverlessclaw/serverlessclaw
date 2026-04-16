import { Resource } from 'sst';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from './utils/ddb-client';
import { emitEvent } from './utils/bus';
import { EventType } from './types/agent';
import { logger } from './logger';
import { ConfigManager } from './registry/config';

/**
 * Handoff Protocol Module
 *
 * Manages transitions between autonomous agent control and active human intervention.
 */

const DEFAULT_HANDOFF_TTL_SECONDS = 120; // 2 minutes of silence before agent resumes

/** Loads the handoff TTL from ConfigTable, falling back to the default. */
async function getHandoffTtlSeconds(): Promise<number> {
  try {
    const val = await ConfigManager.getRawConfig('handoff_ttl_seconds');
    if (typeof val === 'number' && val > 0) return val;
  } catch {
    // ignore, use default
  }
  return DEFAULT_HANDOFF_TTL_SECONDS;
}

/**
 * Marks a user as having "active control" of the session.
 * Emits a HANDOFF event to notify all listening agents.
 *
 * @param userId - The ID of the user requesting handoff control.
 * @param sessionId - Optional session ID to scope the handoff to a specific session.
 */
export async function requestHandoff(userId: string, sessionId?: string): Promise<void> {
  const docClient = getDocClient();

  // Safe resource check for test environments
  if (typeof Resource === 'undefined' || !('MemoryTable' in Resource)) {
    return;
  }

  const resource = Resource as unknown as { MemoryTable: { name: string } };
  const tableName = resource.MemoryTable.name;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (await getHandoffTtlSeconds());

  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          userId: `HANDOFF#${userId}`,
          timestamp: 0,
          type: 'HANDOFF',
          expiresAt,
          sessionId,
          updatedAt: Date.now(),
        },
      })
    );

    await emitEvent('handoff-protocol', EventType.HANDOFF, {
      userId,
      sessionId,
      expiresAt: expiresAt * 1000,
    });

    logger.info(
      `[Handoff] Human control active for user ${userId} until ${new Date(expiresAt * 1000).toISOString()}`
    );
  } catch (error) {
    logger.error(`[Handoff] Failed to record handoff for ${userId}:`, error);
  }
}

/**
 * Checks if a human is currently taking control of the session.
 * @param userId - The user ID to check.
 * @param sessionId - Optional session ID to scope the check to a specific session.
 * @returns boolean - True if agent should enter OBSERVE mode.
 */
export async function isHumanTakingControl(userId: string, sessionId?: string): Promise<boolean> {
  const docClient = getDocClient();

  // Safe resource check for test environments
  if (typeof Resource === 'undefined' || !('MemoryTable' in Resource)) {
    return false;
  }

  const resource = Resource as unknown as { MemoryTable: { name: string } };
  const tableName = resource.MemoryTable.name;

  try {
    const response = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          userId: `HANDOFF#${userId}`,
          timestamp: 0,
        },
      })
    );

    if (!response.Item) return false;

    const now = Math.floor(Date.now() / 1000);
    const hasNotExpired = (response.Item.expiresAt as number) > now;

    if (!hasNotExpired) return false;

    // If sessionId was provided, verify it matches the stored session
    // If stored handoff has no sessionId, it's a global handoff and should apply to all sessions
    if (sessionId && response.Item.sessionId && response.Item.sessionId !== sessionId) {
      return false;
    }

    return true;
  } catch (error) {
    logger.warn(`[Handoff] Failed to check handoff status for ${userId}:`, error);
    return false;
  }
}
