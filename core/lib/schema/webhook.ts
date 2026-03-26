import { z } from 'zod';
import { ATTACHMENT_SCHEMA } from './events';

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
      })
      .passthrough(),
    text: z.string().optional(),
    caption: z.string().optional(),
    photo: z.array(TELEGRAM_INBOUND_PHOTO_SCHEMA).optional(),
    document: TELEGRAM_DOCUMENT_PAYLOAD_SCHEMA.optional(),
    voice: TELEGRAM_VOICE_PAYLOAD_SCHEMA.optional(),
  })
  .passthrough()
  .transform((data) => ({
    ...data,
    // Source-side normalization of the user's input text
    userText: data.text ?? data.caption ?? '',
    chatId: data.chat.id.toString(),
  }));

/**
 * Schema for a generic Telegram update payload.
 * Message is optional because Telegram sends many update types we intentionally ignore.
 */
export const TELEGRAM_UPDATE_SCHEMA = z
  .object({
    update_id: z.number().optional(),
    message: TELEGRAM_MESSAGE_SCHEMA.optional(),
  })
  .passthrough();

/**
 * Schema for a generic Telegram file object.
 */
export const TELEGRAM_FILE_SCHEMA = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  file_size: z.number().optional(),
  file_path: z.string().optional(),
});

/**
 * Schema for a generic Telegram photo size object.
 */
export const TELEGRAM_PHOTO_SIZE_SCHEMA = TELEGRAM_FILE_SCHEMA.extend({
  width: z.number(),
  height: z.number(),
});

/**
 * Schema for a generic Telegram document object.
 */
export const TELEGRAM_DOCUMENT_SCHEMA = TELEGRAM_FILE_SCHEMA.extend({
  thumb: z.any().optional(), // Specific PhotoSize schema can be added
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
});

/**
 * Schema for a generic Telegram voice object.
 */
export const TELEGRAM_VOICE_SCHEMA = TELEGRAM_FILE_SCHEMA.extend({
  duration: z.number(),
  mime_type: z.string().optional(),
});

/**
 * Schema for parsed Telegram message data, used for attachments.
 * Re-exports ATTACHMENT_SCHEMA from events for backward compatibility.
 */
export const TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA = ATTACHMENT_SCHEMA.extend({
  url: z.string(), // Telegram requires URL to be present
});

/**
 * Schema for parsed Telegram message object.
 */
export const PARSED_TELEGRAM_MESSAGE_SCHEMA = z.object({
  chatId: z.string(),
  userText: z.string(),
  attachments: z.array(ATTACHMENT_SCHEMA),
});
