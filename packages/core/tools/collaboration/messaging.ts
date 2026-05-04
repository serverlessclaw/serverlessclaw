import { collaborationSchema as schema } from './schema';
import { sendOutboundMessage } from '../../lib/outbound';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Sends a direct message to the user chat session.
 */
export const sendMessage = {
  ...schema.sendMessage,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { message, userId, sessionId, agentName, traceId } = args as {
      message: string;
      userId: string;
      sessionId?: string;
      agentName?: string;
      traceId?: string;
    };

    if (!userId) {
      return 'Failed to send message: userId is required.';
    }

    try {
      await sendOutboundMessage(
        'tool.sendMessage',
        userId,
        message,
        [userId],
        sessionId,
        agentName,
        undefined,
        traceId
      );
      return 'Message sent successfully to user.';
    } catch (error) {
      return `Failed to send message: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Retrieves messages from a session or collaboration.
 */
export const getMessages = {
  ...schema.getMessages,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { sessionId, limit = 50 } = args as {
      sessionId: string;
      limit?: number;
    };

    if (!sessionId) {
      return 'Failed to get messages: sessionId is required.';
    }

    try {
      const { DynamoMemory } = await import('../../lib/memory');
      const memory = new DynamoMemory();
      const history = await memory.getHistory(sessionId);
      const recentMessages = history.slice(-limit);
      return JSON.stringify(recentMessages, null, 2);
    } catch (error) {
      return `Failed to get messages: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Broadcasts a message to all active agents or sessions.
 */
export const broadcastMessage = {
  ...schema.broadcastMessage,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { message, category } = args as { message: string; category?: string };
    try {
      const { emitEvent } = await import('../../lib/utils/bus');
      await emitEvent('system.broadcast', 'broadcast_message', {
        message,
        category: category ?? 'general',
        timestamp: Date.now(),
      });
      return `Broadcast message sent: ${message}`;
    } catch (error) {
      return `Failed to broadcast message: ${formatErrorMessage(error)}`;
    }
  },
};
