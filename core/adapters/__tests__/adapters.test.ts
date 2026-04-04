import { describe, it, expect, vi } from 'vitest';
import { TelegramAdapter } from '../input/telegram';
import { GenericHTTPAdapter } from '../input/generic-http';
import { GitHubAdapter } from '../input/github';
import { JiraAdapter } from '../input/jira';

vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'test-token' },
    StagingBucket: { name: 'test-bucket' },
  },
}));

describe('TelegramAdapter', () => {
  const adapter = new TelegramAdapter({
    token: 'test-token',
    bucketName: 'test-bucket',
  });

  it('should parse a valid telegram message', () => {
    const raw = {
      update_id: 12345,
      message: {
        chat: { id: 98765 },
        text: 'Hello world',
      },
    };

    const result = adapter.parse(raw);

    expect(result.source).toBe('telegram');
    expect(result.userId).toBe('98765');
    expect(result.sessionId).toBe('98765');
    expect(result.text).toBe('Hello world');
    expect(result.attachments).toEqual([]);
    expect(result.metadata.updateId).toBe(12345);
  });

  it('should parse telegram message with caption', () => {
    const raw = {
      message: {
        chat: { id: 'user123' },
        caption: 'Photo caption',
        photo: [{ file_id: 'abc123' }],
      },
    };

    const result = adapter.parse(raw);

    expect(result.text).toBe('Photo caption');
    expect((result.metadata.rawMessage as Record<string, unknown>).photo).toBeDefined();
  });

  it('should return no-op for non-message update', () => {
    const raw = { update_id: 12345 };
    const result = adapter.parse(raw);

    expect(result.userId).toBe('non-message-update');
    expect(result.text).toBe('');
    expect(result.metadata.updateId).toBe(12345);
    expect(result.metadata.rawMessage).toBeUndefined();
  });
});

describe('GenericHTTPAdapter', () => {
  const adapter = new GenericHTTPAdapter();

  it('should parse a raw JSON string', () => {
    const raw = JSON.stringify({
      userId: 'user1',
      text: 'Test message',
    });

    const result = adapter.parse(raw);

    expect(result.source).toBe('generic-http');
    expect(result.userId).toBe('user1');
    expect(result.sessionId).toBe('user1');
    expect(result.text).toBe('Test message');
  });

  it('should parse an API Gateway event', () => {
    const raw = {
      body: JSON.stringify({
        userId: 'user2',
        sessionId: 'session1',
        text: 'API message',
        metadata: { source: 'api' },
      }),
    };

    const result = adapter.parse(raw);

    expect(result.userId).toBe('user2');
    expect(result.sessionId).toBe('session1');
    expect(result.text).toBe('API message');
    expect(result.metadata.source).toBe('api');
  });

  it('should throw if userId is missing', () => {
    const raw = JSON.stringify({ text: 'No user' });

    expect(() => adapter.parse(raw)).toThrow();
  });
});

describe('GitHubAdapter', () => {
  const secret = 'test-secret';
  const adapter = new GitHubAdapter({ webhookSecret: secret });

  it('should verify a valid signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const signature = 'sha256=6e939b5b3d3e8eba83ff81dde0030a8f2190d965e8bec7a17842863e979c4d7d';

    expect(adapter.verifySignature(payload, signature)).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const signature = 'sha256=wrong';

    expect(adapter.verifySignature(payload, signature)).toBe(false);
  });

  it('should parse an issue opened event via API Gateway with signature', () => {
    const body = JSON.stringify({
      action: 'opened',
      issue: {
        number: 42,
        title: 'Bug: Something broken',
        user: { login: 'dev123' },
      },
      repository: { full_name: 'org/repo' },
      sender: { login: 'dev123' },
    });

    const signature = 'sha256=2d3ecf710e48d56315153350beb14db161ee112771e1d4c4da671f27297a3e12';

    const event = {
      body,
      headers: {
        'x-hub-signature-256': signature,
        'x-github-event': 'issues',
      },
    };

    const result = adapter.parse(event);

    expect(result.userId).toBe('dev123');
    expect(result.metadata.githubEventType).toBe('issues');
  });

  it('should throw if signature is invalid in parse', () => {
    const event = {
      body: JSON.stringify({ action: 'opened' }),
      headers: {
        'x-hub-signature-256': 'sha256=wrong',
      },
    };

    expect(() => adapter.parse(event)).toThrow('Invalid GitHub signature');
  });
});

describe('JiraAdapter', () => {
  const secret = 'jira-secret';
  const adapter = new JiraAdapter({ webhookSecret: secret });

  it('should verify valid secret in header', () => {
    expect(adapter.verifySecret({ 'x-jira-webhook-secret': secret }, {})).toBe(true);
  });

  it('should verify valid secret in query', () => {
    expect(adapter.verifySecret({}, { secret: secret })).toBe(true);
  });

  it('should reject invalid secret', () => {
    expect(adapter.verifySecret({ 'x-jira-webhook-secret': 'wrong' }, {})).toBe(false);
  });

  it('should parse an issue created event', () => {
    const raw = {
      webhookEvent: 'jira:issue_created',
      issue: {
        id: '10001',
        key: 'PROJ-123',
        fields: {
          summary: 'Implement new feature',
          description: 'We need this feature',
          status: { name: 'To Do' },
          reporter: { displayName: 'John Doe' },
        },
      },
      user: { displayName: 'John Doe' },
    };

    const result = adapter.parse(raw);

    expect(result.source).toBe('jira');
    expect(result.userId).toBe('John Doe');
    expect(result.sessionId).toBe('jira-PROJ-123');
    expect(result.metadata.jiraWebhookEvent).toBe('jira:issue_created');
  });
});
