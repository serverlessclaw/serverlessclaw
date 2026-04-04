import { z } from 'zod';
import { AttachmentType } from '../../lib/types/llm';

export const AttachmentSchema = z.object({
  type: z.nativeEnum(AttachmentType),
  url: z.string().url().optional(),
  base64: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
});

export type Attachment = z.infer<typeof AttachmentSchema>;

export const InboundMessageSchema = z.object({
  source: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  text: z.string(),
  attachments: z.array(AttachmentSchema).default(() => []),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
  timestamp: z.string().optional(),
});

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

export interface InputAdapter {
  readonly source: string;
  parse(raw: unknown): InboundMessage;
  processMedia?(message: InboundMessage): Promise<InboundMessage>;
}
