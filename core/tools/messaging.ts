import { toolDefinitions } from './definitions';
import { sendOutboundMessage } from '../lib/outbound';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * Sends a direct message to the user chat session.
 * Used by agents to communicate findings, status, or greetings directly.
 */
export const sendMessage = {
  ...toolDefinitions.sendMessage,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { message, userId, sessionId, agentName, traceId } = args as {
      message: string;
      userId: string;
      sessionId?: string;
      agentName?: string;
      traceId?: string;
    };

    try {
      // source is hardcoded to 'tool.sendMessage' but we could propagate agentId if needed
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
