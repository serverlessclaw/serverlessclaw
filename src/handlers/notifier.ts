import { Resource } from 'sst';

export const handler = async (event: any) => {
  console.log('NotifierAgent received event:', JSON.stringify(event, null, 2));

  // The event is wrapped by EventBridge, the actual payload is in event.detail
  const payload = event.detail;
  if (!payload || !payload.userId || !payload.message) {
    console.error('Missing userId or message in OUTBOUND_MESSAGE event');
    return;
  }

  const { userId, message } = payload;

  // Telegram Adapter
  await sendTelegramMessage(userId, message);

  // Future Adapters (Slack, Discord, Dashboard WebSockets) can be added here
  // based on ConfigTable preferences
};

async function sendTelegramMessage(chatId: string, text: string) {
  try {
    const token = (Resource as any).TelegramBotToken.value;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API error:', errorText);
    }
  } catch (e) {
    console.error('Failed to send Telegram message:', e);
  }
}
