import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { TraceSource, SSTResource } from '../lib/types/index';
import { Resource } from 'sst';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { TelegramUpdateSchema } from '../lib/schema/webhook';

const typedResource = Resource as unknown as SSTResource;
const s3 = new S3Client({});

/**
 * Main entry point for Telegram webhooks.
 * Processes user messages, acquires session locks, and delegates to the SuperClaw.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  logger.info('Received event:', JSON.stringify(event, null, 2));

  let parsedUpdate: z.infer<typeof TelegramUpdateSchema>;
  try {
    if (!event.body) {
      throw new Error('Missing event body');
    }
    parsedUpdate = TelegramUpdateSchema.parse(JSON.parse(event.body));
  } catch (error) {
    logger.error('Failed to parse or validate Telegram update:', error);
    return { statusCode: 400, body: 'Invalid Telegram update format or missing body' };
  }

  const message = parsedUpdate.message;
  if (!message) {
    // Non-message updates should be acknowledged so Telegram does not retry.
    return { statusCode: 200, body: 'OK' };
  }

  const hasActionableContent =
    !!message.text ||
    !!message.caption ||
    !!(message.photo && message.photo.length > 0) ||
    !!message.document ||
    !!message.voice;

  if (!hasActionableContent) {
    return { statusCode: 200, body: 'OK' };
  }

  const chatId = message.chat.id.toString();
  const userText = message.text ?? message.caption ?? '';

  const attachments = await processTelegramMedia(message);

  // Lazy load dependencies to reduce initial context budget
  const [
    { DynamoMemory },
    { ProviderManager },
    { DynamoLockManager },
    { getAgentTools },
    { SuperClaw },
    { AgentRegistry },
  ] = await Promise.all([
    import('../lib/memory'),
    import('../lib/providers/index'),
    import('../lib/lock'),
    import('../tools/index'),
    import('../agents/superclaw'),
    import('../lib/registry'),
  ]);

  const memory = new DynamoMemory();
  const provider = new ProviderManager();
  const lockManager = new DynamoLockManager();

  // 1. Acquire Lock
  const acquired = await lockManager.acquire(chatId, 60);
  if (!acquired) {
    logger.info(`Could not acquire lock for session ${chatId}. Task probably in progress.`);
    return { statusCode: 200, body: 'Task in progress' };
  }

  try {
    // 2. Process message via Agent
    const config = await AgentRegistry.getAgentConfig('main');
    if (!config) throw new Error('Main agent config missing');

    const { profile, cleanText } = SuperClaw.parseCommand(userText);

    const agentTools = await getAgentTools('main');
    const agent = new SuperClaw(memory, provider, agentTools, config);
    const { responseText, attachments: resultAttachments } = await agent.process(
      chatId,
      cleanText,
      {
        profile,
        context,
        source: TraceSource.TELEGRAM,
        attachments,
      }
    );

    // 3. Send response to Notifier via AgentBus
    await sendOutboundMessage(
      'webhook.handler',
      chatId,
      responseText,
      undefined,
      undefined,
      'SuperClaw',
      resultAttachments
    );
  } finally {
    // 4. Release Lock
    await lockManager.release(chatId);
  }

  return { statusCode: 200, body: 'OK' };
};

/**
 * Processes Telegram media attachments (photos, documents).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processTelegramMedia(message: Record<string, any>): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachments: any[] = [];
  const token = typedResource.TelegramBotToken.value;

  try {
    if (message.photo) {
      // Pick the largest photo size
      const photo = message.photo[message.photo.length - 1];
      const result = await handleTelegramFile(photo.file_id, 'image', token);
      if (result) attachments.push(result);
    }

    if (message.document) {
      const result = await handleTelegramFile(
        message.document.file_id,
        'file',
        token,
        message.document.file_name,
        message.document.mime_type
      );
      if (result) attachments.push(result);
    }

    if (message.voice) {
      const result = await handleTelegramFile(
        message.voice.file_id,
        'file',
        token,
        'voice.ogg',
        'audio/ogg'
      );
      if (result) attachments.push(result);
    }
  } catch (error) {
    logger.error('Error processing Telegram media:', error);
  }

  return attachments;
}

/**
 * Downloads a file from Telegram and uploads it to S3.
 */
async function handleTelegramFile(
  fileId: string,
  type: 'image' | 'file',
  token: string,
  fileName?: string,
  mimeType?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  try {
    // 1. Get file path from Telegram
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
    );
    const fileInfo = await fileInfoResponse.json();
    if (!fileInfo.ok) {
      logger.error('Telegram getFile failed:', fileInfo.description);
      return null;
    }

    const filePath = fileInfo.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

    // 2. Download file buffer
    const response = await fetch(downloadUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // 3. Upload to S3 StagingBucket
    const key = `chat-attachments/${Date.now()}-${fileName ?? fileId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bucketName = (typedResource as any).StagingBucket.name;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    const s3Url = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attachment: any = {
      type,
      name: fileName ?? key.split('/').pop(),
      mimeType,
      url: s3Url,
    };

    // For images, provide base64 for direct vision processing if small enough
    if (type === 'image' && buffer.length < 5 * 1024 * 1024) {
      attachment.base64 = buffer.toString('base64');
    }

    return attachment;
  } catch (error) {
    logger.error('Failed to handle telegram file:', error);
    return null;
  }
}
