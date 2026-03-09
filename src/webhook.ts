import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoMemory } from './memory';
import { Agent } from './agent';
import { OpenAIProvider } from './provider';
import { tools } from './tools';
import { Resource } from 'sst';

const memory = new DynamoMemory();
const provider = new OpenAIProvider();
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

  // Process message via Agent
  const responseText = await agent.process(chatId, userText);

  // Send response to Telegram
  await sendTelegramMessage(chatId, responseText);

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
