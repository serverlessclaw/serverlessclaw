import { DynamoMemory } from './memory';
import { Agent } from './agent';
import { OpenAIProvider } from './provider';
import { tools } from './tools';
import { DynamoLockManager } from './lock';
import { Resource } from 'sst';

const memory = new DynamoMemory();
const provider = new OpenAIProvider();
const lockManager = new DynamoLockManager();
const agent = new Agent(memory, provider, Object.values(tools));

export const handler = async (event: APIGatewayProxyEventV2) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

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
    console.log(`Could not acquire lock for session ${chatId}. Task probably in progress.`);
    return { statusCode: 200, body: 'Task in progress' };
  }

  try {
    // 2. Process message via Agent
    const responseText = await agent.process(chatId, userText);

    // 3. Send response to Telegram
    await sendTelegramMessage(chatId, responseText);
  } finally {
    // 4. Release Lock
    await lockManager.release(chatId);
  }

  return { statusCode: 200, body: 'OK' };
};

async function sendTelegramMessage(chatId: string, text: string) {
  const token = Resource.TelegramBotToken.value;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}
