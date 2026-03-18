import { z } from 'zod';

const TelegramInboundPhotoSchema = z
  .object({
    file_id: z.string(),
  })
  .passthrough();

const TelegramDocumentPayloadSchema = z
  .object({
    file_id: z.string(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .passthrough();

const TelegramVoicePayloadSchema = z
  .object({
    file_id: z.string(),
  })
  .passthrough();

const TelegramMessageSchema = z
  .object({
    chat: z
      .object({
        id: z.union([z.number(), z.string()]),
      })
      .passthrough(),
    text: z.string().optional(),
    caption: z.string().optional(),
    photo: z.array(TelegramInboundPhotoSchema).optional(),
    document: TelegramDocumentPayloadSchema.optional(),
    voice: TelegramVoicePayloadSchema.optional(),
  })
  .passthrough();

/**
 * Schema for a generic Telegram update payload.
 * Message is optional because Telegram sends many update types we intentionally ignore.
 */
export const TelegramUpdateSchema = z
  .object({
    update_id: z.number().optional(),
    message: TelegramMessageSchema.optional(),
  })
  .passthrough();

/**
 * Schema for a generic Telegram file object.
 */
export const TelegramFileSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  file_size: z.number().optional(),
  file_path: z.string().optional(),
});

/**
 * Schema for a generic Telegram photo size object.
 */
export const TelegramPhotoSizeSchema = TelegramFileSchema.extend({
  width: z.number(),
  height: z.number(),
});

/**
 * Schema for a generic Telegram document object.
 */
export const TelegramDocumentSchema = TelegramFileSchema.extend({
  thumb: z.any().optional(), // Specific PhotoSize schema can be added
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
});

/**
 * Schema for a generic Telegram voice object.
 */
export const TelegramVoiceSchema = TelegramFileSchema.extend({
  duration: z.number(),
  mime_type: z.string().optional(),
});

/**
 * Schema for parsed Telegram message data, used for attachments.
 */
export const TelegramMessageAttachmentSchema = z.object({
  type: z.enum(['image', 'file']),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  url: z.string(),
  base64: z.string().optional(),
});

/**
 * Schema for parsed Telegram message object.
 */
export const ParsedTelegramMessageSchema = z.object({
  chatId: z.string(),
  userText: z.string(),
  attachments: z.array(TelegramMessageAttachmentSchema),
});
