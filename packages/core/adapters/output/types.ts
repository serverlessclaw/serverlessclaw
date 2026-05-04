import { z } from 'zod';

export const OutboundMessageSchema = z.object({
  source: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  text: z.string(),
  platform: z.enum(['telegram', 'discord', 'slack', 'github', 'jira', 'generic']),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
  timestamp: z.string().optional(),
});

export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;

export interface OutputAdapter {
  readonly platform: string;
  send(message: OutboundMessage): Promise<void>;
}
