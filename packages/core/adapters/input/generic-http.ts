import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { InputAdapter, InboundMessage } from './types';
import { AttachmentSchema } from './types';
import { logger } from '../../lib/logger';

const GenericWebhookSchema = z.object({
  userId: z.string(),
  sessionId: z.string().optional(),
  text: z.string(),
  attachments: z.array(AttachmentSchema).default(() => []),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});

export class GenericHTTPAdapter implements InputAdapter {
  readonly source = 'generic-http';
  readonly version = '1.0.0';

  parse(raw: unknown): InboundMessage {
    let body: unknown;
    try {
      if (typeof raw === 'string') {
        body = JSON.parse(raw);
      } else if (raw && typeof raw === 'object' && 'body' in raw) {
        const event = raw as APIGatewayProxyEventV2;
        body = event.body ? JSON.parse(event.body) : raw;
      } else {
        body = raw;
      }
    } catch {
      throw new Error('Invalid JSON payload');
    }

    const result = GenericWebhookSchema.safeParse(body);
    if (!result.success) {
      logger.error('Generic HTTP schema validation failed:', result.error.format());
      throw new Error(`Invalid generic webhook payload: ${result.error.message}`);
    }

    const parsed = result.data;

    return {
      source: this.source,
      userId: parsed.userId,
      sessionId: parsed.sessionId ?? parsed.userId,
      text: parsed.text,
      attachments: parsed.attachments,
      metadata: parsed.metadata,
      timestamp: new Date().toISOString(),
    };
  }
}
