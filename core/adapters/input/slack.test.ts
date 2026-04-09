import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { SlackAdapter } from './slack';

describe('SlackAdapter', () => {
  const signingSecret = 'test-secret';
  const adapter = new SlackAdapter({ signingSecret });

  it('should identify source as slack', () => {
    expect(adapter.source).toBe('slack');
  });

  it('should parse URL verification challenge', () => {
    const payload = {
      type: 'url_verification',
      challenge: '3eZbrw1aBm2JOT2QCm69En3id2z38BffL2skz389809/809809809',
    };

    const result = adapter.parse(payload);
    expect(result.userId).toBe('slack-system');
    expect(result.text).toBe(payload.challenge);
    expect(result.metadata.isChallenge).toBe(true);
  });

  it('should parse a standard message event', () => {
    const payload = {
      token: 'verification_token',
      team_id: 'T12345',
      api_app_id: 'A12345',
      event: {
        type: 'message',
        user: 'U12345',
        text: 'Hello World',
        ts: '1234567890.123456',
        channel: 'C12345',
        event_ts: '1234567890.123456',
      },
      type: 'event_callback',
    };

    const result = adapter.parse(payload);
    expect(result.source).toBe('slack');
    expect(result.userId).toBe('U12345');
    expect(result.sessionId).toBe('slack-C12345');
    expect(result.text).toBe('Hello World');
    expect(result.metadata.slackEventType).toBe('message');
  });

  it('should verify signature correctly', () => {
    // Pre-computed HMAC-SHA256 signature for testing
    const body = '{"type":"event_callback"}';
    // Use a live timestamp so the anti-replay window check passes in tests
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sigBaseString = `v0:${timestamp}:${body}`;
    const expectedSig = `v0=${createHmac('sha256', signingSecret)
      .update(sigBaseString)
      .digest('hex')}`;

    // Valid signature should pass
    expect(adapter.verifySignature(body, timestamp, expectedSig)).toBe(true);

    // Invalid signature should fail
    expect(adapter.verifySignature(body, timestamp, 'v0=invalid')).toBe(false);

    // Signature with different length should fail
    expect(adapter.verifySignature(body, timestamp, 'v0=abc')).toBe(false);
  });
});
