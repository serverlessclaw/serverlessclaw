import { createHmac } from 'crypto';
import { z } from 'zod';
import { InputAdapter, InboundMessage } from './types';
import { logger } from '../../lib/logger';

const SlackEventSchema = z.object({
  type: z.string().optional(),
  token: z.string().optional(),
  challenge: z.string().optional(),
  team_id: z.string().optional(),
  api_app_id: z.string().optional(),
  event: z
    .object({
      type: z.string(),
      user: z.string().optional(),
      text: z.string().optional(),
      ts: z.string().optional(),
      channel: z.string().optional(),
      event_ts: z.string().optional(),
      thread_ts: z.string().optional(),
    })
    .optional(),
});

export class SlackAdapter implements InputAdapter {
  readonly source = 'slack';
  private readonly signingSecret: string | undefined;

  constructor(options?: { signingSecret?: string }) {
    this.signingSecret = options?.signingSecret ?? process.env.SLACK_SIGNING_SECRET;
  }

  /**
   * Verifies the Slack webhook signature.
   * https://api.slack.com/authentication/verifying-requests-from-slack
   */
  verifySignature(body: string, timestamp: string, signature: string): boolean {
    if (!this.signingSecret) {
      logger.warn('Slack signing secret not configured, skipping verification');
      return true;
    }

    if (!signature || !timestamp) {
      logger.error('Missing Slack signature or timestamp headers');
      return false;
    }

    // Protect against replay attacks
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) {
      logger.error('Slack request timestamp too old');
      return false;
    }

    const sigBaseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', this.signingSecret);
    const mySignature = `v0=${hmac.update(sigBaseString).digest('hex')}`;

    return mySignature === signature;
  }

  parse(raw: unknown): InboundMessage {
    let body: Record<string, unknown>;
    let headers: Record<string, string>;

    if (typeof raw === 'object' && raw !== null && 'body' in raw) {
      const event = raw as { body?: string; headers?: Record<string, string> };
      headers = event.headers || {};
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch {
        throw new Error('Invalid JSON in Slack event body');
      }

      // Verify signature
      const signature = headers['x-slack-signature'] || headers['X-Slack-Signature'];
      const timestamp =
        headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'];
      if (this.signingSecret && signature && timestamp) {
        if (!this.verifySignature(event.body || '', timestamp, signature)) {
          throw new Error('Invalid Slack signature');
        }
      }
    } else {
      body = raw as Record<string, unknown>;
    }

    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return {
        source: this.source,
        userId: 'slack-system',
        sessionId: 'slack-system',
        text: (body.challenge as string) || '',
        attachments: [],
        metadata: { isChallenge: true, challenge: body.challenge as string },
        timestamp: new Date().toISOString(),
      };
    }

    const result = SlackEventSchema.safeParse(body);
    if (!result.success) {
      logger.error('Slack schema validation failed:', result.error.format());
      throw new Error(`Invalid Slack webhook payload: ${result.error.message}`);
    }

    const parsed = result.data;
    const event = parsed.event;

    if (!event) {
      throw new Error('Slack event data missing');
    }

    const userId = event.user || 'slack-unknown';
    const channelId = event.channel || 'unknown-channel';
    const sessionId = `slack-${channelId}`; // Scope by channel for multi-user chat context

    return {
      source: this.source,
      userId,
      sessionId,
      text: event.text || '',
      attachments: [],
      metadata: {
        slackEventType: event.type,
        channelId,
        threadTs: event.thread_ts,
        ts: event.ts,
        teamId: parsed.team_id,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
