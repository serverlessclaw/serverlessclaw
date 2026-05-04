import { z } from 'zod';
import { InputAdapter, InboundMessage, AttachmentSchema } from './types';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Resource } from 'sst';
import { SSTResource } from '../../lib/types/system';
import { logger } from '../../lib/logger';
import { AttachmentType } from '../../lib/types/llm';
import { normalizeMessage } from './normalize';

const typedResource = Resource as unknown as SSTResource;

const TELEGRAM_INBOUND_PHOTO_SCHEMA = z
  .object({
    file_id: z.string(),
  })
  .passthrough();

const TELEGRAM_DOCUMENT_PAYLOAD_SCHEMA = z
  .object({
    file_id: z.string(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .passthrough();

const TELEGRAM_VOICE_PAYLOAD_SCHEMA = z
  .object({
    file_id: z.string(),
  })
  .passthrough();

const TELEGRAM_MESSAGE_SCHEMA = z
  .object({
    chat: z
      .object({
        id: z.union([z.number(), z.string()]),
        type: z.string().optional(),
      })
      .passthrough(),
    from: z
      .object({
        id: z.union([z.number(), z.string()]),
      })
      .passthrough()
      .optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
    photo: z.array(TELEGRAM_INBOUND_PHOTO_SCHEMA).optional(),
    document: TELEGRAM_DOCUMENT_PAYLOAD_SCHEMA.optional(),
    voice: TELEGRAM_VOICE_PAYLOAD_SCHEMA.optional(),
  })
  .passthrough()
  .transform((data) => ({
    ...data,
    userText: data.text ?? data.caption ?? '',
    chatId: data.chat.id.toString(),
    fromId: data.from?.id?.toString(),
    isGroup: data.chat.type === 'group' || data.chat.type === 'supergroup',
  }));

export const TELEGRAM_UPDATE_SCHEMA = z
  .object({
    update_id: z.number().optional(),
    message: TELEGRAM_MESSAGE_SCHEMA.optional(),
  })
  .passthrough();

const FETCH_TIMEOUT_MS = 5000;

export class TelegramAdapter implements InputAdapter {
  readonly source = 'telegram';
  readonly version = '1.0.0';

  private s3: S3Client;
  private token: string;
  private bucketName: string;

  constructor(options?: { s3?: S3Client; token?: string; bucketName?: string }) {
    this.s3 = options?.s3 ?? new S3Client({});
    this.token = options?.token ?? typedResource.TelegramBotToken.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bucketName = options?.bucketName ?? (typedResource as any).StagingBucket.name;
  }

  parse(raw: unknown): InboundMessage {
    let body: unknown;

    if (typeof raw === 'object' && raw !== null && 'body' in raw) {
      const event = raw as { body?: string };
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch {
        throw new Error('Invalid JSON in Telegram event body');
      }
    } else {
      body = raw;
    }

    const result = TELEGRAM_UPDATE_SCHEMA.safeParse(body);
    if (!result.success) {
      logger.error('Telegram schema validation failed:', result.error.format());
      throw new Error(`Invalid Telegram update format: ${result.error.message}`);
    }

    const parsed = result.data;
    if (!parsed.message) {
      // Non-message update (e.g. callback_query, edited_message, etc.)
      // Use update_id as fallback identifier to avoid session collision
      const updateId = parsed.update_id ?? 'unknown';
      const updateType = Object.keys(parsed).find((k) => k !== 'update_id') ?? 'unknown';

      // Return a "no-op" message that the handler will interpret as non-actionable
      // Use composite ID with updateId to avoid collision across different chats/sessions
      return {
        source: this.source,
        userId: `telegram:callback:${updateId}`,
        sessionId: `telegram:callback:${updateId}`,
        text: '',
        attachments: [],
        metadata: {
          updateId: parsed.update_id,
          updateType,
          rawMessage: undefined,
        },
        timestamp: new Date().toISOString(),
      };
    }

    const { chatId, userText, fromId, isGroup } = parsed.message;

    // Use the unified normalization utility before returning
    const rawMessage: InboundMessage = {
      source: this.source,
      userId: chatId,
      sessionId: chatId,
      workspaceId: undefined, // Telegram currently doesn't provide workspaceId
      teamId: isGroup ? chatId : undefined, // Group as Team
      staffId: fromId, // Actual sender
      text: userText,
      attachments: [],
      metadata: {
        updateId: parsed.update_id,
        rawMessage: parsed.message,
      },
      timestamp: new Date().toISOString(),
    };
    // Import the normalizeMessage function
    return normalizeMessage(rawMessage);
  }

  async processMedia(message: InboundMessage): Promise<InboundMessage> {
    const rawMessage = message.metadata.rawMessage as Record<string, unknown> | undefined;
    if (!rawMessage) return message;

    const attachments: Array<z.infer<typeof AttachmentSchema>> = [];

    try {
      if (rawMessage.photo) {
        const photos = rawMessage.photo as Array<{ file_id: string }>;
        const photo = photos[photos.length - 1];
        const result = await this.handleTelegramFile(
          photo.file_id,
          AttachmentType.IMAGE,
          undefined,
          undefined
        );
        if (result) attachments.push(result);
      }

      if (rawMessage.document) {
        const doc = rawMessage.document as {
          file_id: string;
          file_name?: string;
          mime_type?: string;
        };
        const result = await this.handleTelegramFile(
          doc.file_id,
          AttachmentType.FILE,
          doc.file_name,
          doc.mime_type
        );
        if (result) attachments.push(result);
      }

      if (rawMessage.voice) {
        const voice = rawMessage.voice as { file_id: string };
        const result = await this.handleTelegramFile(
          voice.file_id,
          AttachmentType.FILE,
          'voice.ogg',
          'audio/ogg'
        );
        if (result) attachments.push(result);
      }
    } catch (error) {
      logger.error('Error processing Telegram media:', error);
    }

    return {
      ...message,
      attachments,
    };
  }

  private async handleTelegramFile(
    fileId: string,
    type: AttachmentType,
    fileName?: string,
    mimeType?: string
  ): Promise<z.infer<typeof AttachmentSchema> | null> {
    try {
      const fileInfoController = new AbortController();
      const fileInfoTimeout = setTimeout(() => fileInfoController.abort(), FETCH_TIMEOUT_MS);
      const fileInfoResponse = await fetch(
        `https://api.telegram.org/bot${this.token}/getFile?file_id=${fileId}`,
        { signal: fileInfoController.signal }
      );
      clearTimeout(fileInfoTimeout);
      const fileInfo = await fileInfoResponse.json();
      if (!fileInfo.ok) {
        logger.error('Telegram getFile failed:', fileInfo.description);
        return null;
      }

      const filePath = fileInfo.result.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;

      const downloadController = new AbortController();
      const downloadTimeout = setTimeout(() => downloadController.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(downloadUrl, { signal: downloadController.signal });
      clearTimeout(downloadTimeout);
      const buffer = Buffer.from(await response.arrayBuffer());

      const key = `chat-attachments/${Date.now()}-${fileName ?? fileId}`;

      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );

      // Construct robust S3 URL
      const region = process.env.AWS_REGION ?? 'us-east-1';
      const s3Url = `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;

      const attachment: z.infer<typeof AttachmentSchema> = {
        type,
        name: fileName ?? key.split('/').pop(),
        mimeType,
        url: s3Url,
      };

      if (type === AttachmentType.IMAGE && buffer.length < 5 * 1024 * 1024) {
        attachment.base64 = buffer.toString('base64');
      }

      return attachment;
    } catch (error) {
      logger.error('Failed to handle telegram file:', error);
      return null;
    }
  }
}
