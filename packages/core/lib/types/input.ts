import { z } from 'zod';

/**
 * Types of attachments that can be included in messages.
 * Unified across core sensors and integrations.
 */
export enum AttachmentType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  FILE = 'file',
}

/**
 * Shared attachment shape used across messages and events.
 * Enforces that at least one payload source is present.
 */
export const AttachmentSchema = z
  .object({
    type: z.nativeEnum(AttachmentType),
    url: z.string().url().optional(),
    base64: z.string().optional(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .refine((attachment) => Boolean(attachment.url || attachment.base64), {
    message: 'Attachment must include either url or base64 payload',
  });

export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * Common schema for messages coming into any input adapter.
 */
export const InboundMessageSchema = z.object({
  source: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  workspaceId: z.string().optional(),
  teamId: z.string().optional(),
  staffId: z.string().optional(),
  text: z.string(),
  attachments: z.array(AttachmentSchema).default(() => []),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
  timestamp: z.string().optional(),
});

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

/**
 * Interface that all input adapters must implement.
 */
export interface InputAdapter {
  readonly source: string;
  readonly version: string;
  parse(raw: unknown): InboundMessage;
  processMedia?(message: InboundMessage): Promise<InboundMessage>;
}
