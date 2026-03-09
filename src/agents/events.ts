import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { OpenAIProvider } from '../lib/provider';
import { tools } from '../tools/index';
import { Resource } from 'sst';

const memory = new DynamoMemory();
const provider = new OpenAIProvider();
const agent = new Agent(memory, provider, Object.values(tools));

export const handler = async (event: {
  'detail-type': string;
  detail: Record<string, unknown>;
}) => {
  console.log('EventHandler received event:', JSON.stringify(event, null, 2));

  const { userId, buildId, errorLogs } = event.detail as {
    userId: string;
    buildId?: string;
    errorLogs?: string;
  };

  if (event['detail-type'] === 'system_build_failed') {
    const task = `CRITICAL: Deployment ${buildId} failed. 
    Here are the last few lines of the logs:
    ---
    ${errorLogs}
    ---
    Please investigate the codebase, find the root cause, fix the issue, and trigger a new deployment. 
    Explain your plan to the user before proceeding.`;

    // Process the failure context via the Main Agent
    const responseText = await agent.process(userId, `SYSTEM_NOTIFICATION: ${task}`);

    // Notify user on Telegram
    await sendTelegramMessage(userId, responseText);
  }
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
