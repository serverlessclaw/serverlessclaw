import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { TraceSource, AgentType } from '../lib/types/agent';
import { MessageRole, AttachmentType } from '../lib/types/llm';
import { SSTResource } from '../lib/types/system';
import { Resource } from 'sst';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { TELEGRAM_UPDATE_SCHEMA } from '../lib/schema/webhook';

const typedResource = Resource as unknown as SSTResource;

// Default client for backward compatibility - can be overridden for testing
const defaultS3 = new S3Client({});

// Allow tests to inject a custom S3 client
let injectedS3: S3Client | undefined;

/**
 * Sets a custom S3 client for testing purposes.
 * @param s3 - The S3 client to use
 */
export function setS3Client(s3: S3Client): void {
  injectedS3 = s3;
}

function getS3Client(): S3Client {
  return injectedS3 ?? defaultS3;
}

/**
 * Main entry point for Telegram webhooks.
 * Processes user messages, acquires session locks, and delegates to the SuperClaw.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  logger.info('[WEBHOOK] Start | Event:', event.body?.substring(0, 100));

  let parsedUpdate: z.infer<typeof TELEGRAM_UPDATE_SCHEMA>;
  try {
    if (!event.body) {
      throw new Error('Missing event body');
    }
    parsedUpdate = TELEGRAM_UPDATE_SCHEMA.parse(JSON.parse(event.body));
  } catch (error) {
    logger.error('[WEBHOOK] Failed to parse or validate Telegram update:', error);
    return { statusCode: 400, body: 'Invalid Telegram update format or missing body' };
  }

  const message = parsedUpdate.message;
  if (!message) {
    logger.info('[WEBHOOK] No message in update');
    // Non-message updates should be acknowledged so Telegram does not retry.
    return { statusCode: 200, body: 'OK' };
  }

  const { chatId, userText } = message;

  const hasActionableContent =
    userText.length > 0 ||
    !!(message.photo && message.photo.length > 0) ||
    !!message.document ||
    !!message.voice;

  if (!hasActionableContent) {
    logger.info('[WEBHOOK] No actionable content');
    return { statusCode: 200, body: 'OK' };
  }

  logger.info(`[WEBHOOK] User: ${chatId} | Text: ${userText.substring(0, 50)}`);

  const attachments = await processTelegramMedia(message);

  // Lazy load dependencies to reduce initial context budget
  logger.info('[WEBHOOK] Lazy loading deps...');
  const [
    { DynamoMemory },
    { ProviderManager },
    { SessionStateManager },
    { getAgentTools },
    { SuperClaw },
    { AgentRegistry },
    { requestHandoff },
  ] = await Promise.all([
    import('../lib/memory'),
    import('../lib/providers/index'),
    import('../lib/session/session-state'),
    import('../tools/index'),
    import('../agents/superclaw'),
    import('../lib/registry'),
    import('../lib/handoff'),
  ]);

  const memory = new DynamoMemory();
  const provider = new ProviderManager();
  const sessionStateManager = new SessionStateManager();
  const lambdaRequestId = context.awsRequestId;

  // 1. Always add message to conversation history first (no message loss)
  logger.info('[WEBHOOK] Recording message to history...');
  await memory.addMessage(chatId, {
    role: MessageRole.USER,
    content: userText,
    attachments,
  });

  // Request Handoff (Phase B3: Real-time Shared Awareness)
  // Ensures agents enter OBSERVE mode if human is actively typing/sending
  await requestHandoff(chatId);

  // 2. Try to acquire processing flag
  logger.info('[WEBHOOK] Checking processing status...');
  const canProcess = await sessionStateManager.acquireProcessing(chatId, lambdaRequestId);

  if (!canProcess) {
    // Agent is currently processing - add message to pending queue
    logger.info(`[WEBHOOK] Session ${chatId} busy, queuing message...`);
    await sessionStateManager.addPendingMessage(chatId, userText, attachments);
    return { statusCode: 200, body: 'Message queued for processing' };
  }

  try {
    // 3. Process message via Agent
    logger.info('[WEBHOOK] Loading config...');
    const config = await AgentRegistry.getAgentConfig(AgentType.SUPERCLAW);
    if (!config) throw new Error('Main agent config missing');

    const { profile, cleanText } = SuperClaw.parseCommand(userText);

    logger.info('[WEBHOOK] Loading tools...');
    const agentTools = await getAgentTools(AgentType.SUPERCLAW);
    logger.info(`[WEBHOOK] Tools loaded: ${agentTools.map((t) => t.name).join(', ')}`);

    const agent = new SuperClaw(memory, provider, agentTools, config);
    logger.info('[WEBHOOK] Starting agent process...');
    const { responseText, attachments: resultAttachments } = await agent.process(
      chatId,
      cleanText,
      {
        profile,
        context,
        source: TraceSource.TELEGRAM,
        attachments,
        sessionId: chatId,
        sessionStateManager,
      }
    );
    logger.info('[WEBHOOK] Process complete. Response length:', responseText.length);

    // 4. Send response to Notifier via AgentBus
    logger.info('[WEBHOOK] Sending outbound message...');
    await sendOutboundMessage(
      'webhook.handler',
      chatId,
      responseText,
      undefined,
      undefined,
      'SuperClaw',
      resultAttachments
    );
    logger.info('[WEBHOOK] All done.');
  } catch (err) {
    logger.error('[WEBHOOK] Execution Error:', err);
    throw err;
  } finally {
    // 5. Release processing flag
    await sessionStateManager.releaseProcessing(chatId);
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
      const result = await handleTelegramFile(photo.file_id, AttachmentType.IMAGE, token);
      if (result) attachments.push(result);
    }

    if (message.document) {
      const result = await handleTelegramFile(
        message.document.file_id,
        AttachmentType.FILE,
        token,
        message.document.file_name,
        message.document.mime_type
      );
      if (result) attachments.push(result);
    }

    if (message.voice) {
      const result = await handleTelegramFile(
        message.voice.file_id,
        AttachmentType.FILE,
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
  type: AttachmentType,
  token: string,
  fileName?: string,
  mimeType?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const s3 = getS3Client();
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
    if (type === AttachmentType.IMAGE && buffer.length < 5 * 1024 * 1024) {
      attachment.base64 = buffer.toString('base64');
    }

    return attachment;
  } catch (error) {
    logger.error('Failed to handle telegram file:', error);
    return null;
  }
}
