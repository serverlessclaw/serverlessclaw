import { Resource } from 'sst';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from './utils/ddb-client';
import { emitEvent } from './utils/bus';
import { EventType } from './types/agent';
import { logger } from './logger';

/**
 * Handoff Protocol Module
 *
 * Manages transitions between autonomous agent control and active human intervention.
 */

const HANDOFF_TTL_SECONDS = 120; // 2 minutes of silence before agent resumes

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
  const expiresAt = now + HANDOFF_TTL_SECONDS;

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
 * @returns boolean - True if agent should enter OBSERVE mode.
 */
export async function isHumanTakingControl(userId: string): Promise<boolean> {
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
    return (response.Item.expiresAt as number) > now;
  } catch (error) {
    logger.warn(`[Handoff] Failed to check handoff status for ${userId}:`, error);
    return false;
  }
}
