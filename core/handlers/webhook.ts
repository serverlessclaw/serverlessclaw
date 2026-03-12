import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';

import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { DynamoLockManager } from '../lib/lock';
import { ReasoningProfile } from '../lib/types/index';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const lockManager = new DynamoLockManager();

/**
 * Main entry point for Telegram webhooks.
 * Processes user messages, acquires session locks, and delegates to the SuperClaw.
 *
 * @param event - The API Gateway event containing the Telegram update.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to an API Gateway response.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
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
    const { AgentRegistry } = await import('../lib/registry');
    const config = await AgentRegistry.getAgentConfig('main');
    if (!config) throw new Error('Main agent config missing');

    // Detect Reasoning Profile from commands
    let profile: ReasoningProfile | undefined;
    let cleanText = userText;
    if (userText.startsWith('/deep ')) {
      profile = ReasoningProfile.DEEP;
      cleanText = userText.replace('/deep ', '');
    } else if (userText.startsWith('/thinking ')) {
      profile = ReasoningProfile.THINKING;
      cleanText = userText.replace('/thinking ', '');
    } else if (userText.startsWith('/fast ')) {
      profile = ReasoningProfile.FAST;
      cleanText = userText.replace('/fast ', '');
    }

    const agentTools = await getAgentTools('main');
    const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);
    const responseText = await agent.process(chatId, cleanText, {
      profile,
      context,
      source: 'telegram',
      // isContinuation is not directly applicable to APIGatewayProxyEventV2 from Telegram
    });

    // 3. Send response to Notifier via AgentBus
    await sendOutboundMessage('webhook.handler', chatId, responseText);
  } finally {
    // 4. Release Lock
    await lockManager.release(chatId);
  }

  return { statusCode: 200, body: 'OK' };
};
