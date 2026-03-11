import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';

import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { DynamoLockManager } from '../lib/lock';
import { SUPERCLAW_SYSTEM_PROMPT } from '../agents/superclaw';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const lockManager = new DynamoLockManager();

/**
 * Main entry point for Telegram webhooks.
 * Processes user messages, acquires session locks, and delegates to the SuperClaw.
 *
 * @param event - The API Gateway event containing the Telegram update.
 * @returns A promise that resolves to an API Gateway response.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  logger.info('Received event:', JSON.stringify(event, null, 2));

  if (!event.body) {
    return { statusCode: 400, body: 'Missing body' };
  }

  const update = JSON.parse(event.body);
  const message = update.message;

  if (!message || !message.text) {
    return { statusCode: 200, body: 'OK' };
  }

  const chatId = message.chat.id.toString();
  const userText = message.text;

  // 1. Acquire Lock
  const acquired = await lockManager.acquire(chatId, 60);
  if (!acquired) {
    logger.info(`Could not acquire lock for session ${chatId}. Task probably in progress.`);
    return { statusCode: 200, body: 'Task in progress' };
  }

  try {
    // 2. Process message via Agent
    const agentTools = await getAgentTools('main');
    const agent = new Agent(memory, provider, agentTools, SUPERCLAW_SYSTEM_PROMPT);
    const responseText = await agent.process(chatId, userText);

    // 3. Send response to Notifier via AgentBus
    await sendOutboundMessage('webhook.handler', chatId, responseText);
  } finally {
    // 4. Release Lock
    await lockManager.release(chatId);
  }

  return { statusCode: 200, body: 'OK' };
};
