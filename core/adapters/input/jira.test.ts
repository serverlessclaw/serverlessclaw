import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraAdapter } from './jira';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('JiraAdapter', () => {
  const secret = 'test-secret';
  const baseUrl = 'https://test.atlassian.net';
  const email = 'test@example.com';
  const apiToken = 'test-token';

  let adapter: JiraAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new JiraAdapter({
      webhookSecret: secret,
      baseUrl,
      email,
      apiToken,
    });
    global.fetch = vi.fn();
  });

  describe('verifySecret', () => {
    it('should verify secret from header', () => {
      expect(adapter.verifySecret({ 'x-jira-webhook-secret': secret }, {})).toBe(true);
    });

    it('should verify secret from query', () => {
      expect(adapter.verifySecret({}, { secret: secret })).toBe(true);
    });

    it('should return true if no secret configured', () => {
      const noSecretAdapter = new JiraAdapter({});
      expect(noSecretAdapter.verifySecret({}, {})).toBe(true);
    });

    it('should return false for invalid secret', () => {
      expect(adapter.verifySecret({ 'x-jira-webhook-secret': 'wrong' }, {})).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse an API Gateway event with authentication', () => {
      const body = {
        webhookEvent: 'jira:issue_created',
        issue: {
          key: 'PROJ-123',
          fields: {
            summary: 'Broken button',
            description: 'The button is broken',
            status: { name: 'To Do' },
          },
        },
      };

      const event = {
        body: JSON.stringify(body),
        headers: { 'x-jira-webhook-secret': secret },
      };

      const result = adapter.parse(event);
      expect(result.text).toContain('Issue PROJ-123: Broken button');
      expect(result.sessionId).toBe('jira-PROJ-123');
    });

    it('should throw if authentication fails in parse', () => {
      const event = {
        body: JSON.stringify({}),
        headers: { 'x-jira-webhook-secret': 'wrong' },
      };

      expect(() => adapter.parse(event)).toThrow('Unauthorized Jira webhook');
    });

    it('should handle comment events', () => {
      const body = {
        webhookEvent: 'jira:comment_created',
        issue: {
          key: 'PROJ-123',
          fields: { summary: 'Original issue' },
        },
        comment: {
          body: 'This is a comment',
          author: { displayName: 'Alice' },
        },
      };

      const result = adapter.parse(body);
      expect(result.text).toBe('Comment on PROJ-123: This is a comment');
      expect(result.userId).toBe('Alice');
    });

    it('should handle missing fields gracefully', () => {
      const body = {
        webhookEvent: 'jira:issue_updated',
        issue: {},
        user: { displayName: 'Bob' },
      };

      const result = adapter.parse(body);
      expect(result.userId).toBe('Bob');
      expect(result.text).toContain('Jira jira:issue_updated event from Bob');
    });

    it('should throw on invalid JSON string', () => {
      expect(() => adapter.parse('invalid-json')).toThrow('Invalid JSON format');
    });

    it('should throw on invalid JSON in event body', () => {
      expect(() =>
        adapter.parse({
          body: 'invalid',
          headers: { 'x-jira-webhook-secret': secret },
        })
      ).toThrow('Invalid JSON in event body');
    });
  });

  describe('createIssue', () => {
    it('should successfully create an issue', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ key: 'PROJ-456' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await adapter.createIssue({
        project: 'PROJ',
        title: 'New bug',
        body: 'Description here',
      });

      expect(result.key).toBe('PROJ-456');
      expect(result.url).toBe(`${baseUrl}/browse/PROJ-456`);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/api/3/issue'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('New bug'),
        })
      );
    });

    it('should throw if required env vars are missing', async () => {
      const badAdapter = new JiraAdapter({});
      await expect(badAdapter.createIssue({ title: 'x', body: 'y' })).rejects.toThrow(
        /environment variables are required/
      );
    });

    it('should throw if project is missing', async () => {
      await expect(adapter.createIssue({ title: 'x', body: 'y' })).rejects.toThrow(
        'Project key is required'
      );
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid field'),
      });

      await expect(adapter.createIssue({ project: 'P', title: 'T', body: 'B' })).rejects.toThrow(
        'Failed to create issue: Bad Request'
      );
    });
  });

  describe('addComment', () => {
    it('should successfully add a comment', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });

      const result = await adapter.addComment({
        issueKey: 'PROJ-123',
        body: 'Nice work',
      });

      expect(result.url).toBe(`${baseUrl}/browse/PROJ-123`);
    });

    it('should throw if issueKey is missing', async () => {
      await expect(adapter.addComment({ body: 'x' })).rejects.toThrow('Issue Key is required');
    });
  });

  describe('getIssue', () => {
    it('should successfully fetch an issue', async () => {
      const mockIssue = {
        key: 'PROJ-123',
        fields: {
          summary: 'The summary',
          description: {
            content: [{ content: [{ text: 'The description' }] }],
          },
          status: { name: 'In Progress' },
        },
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIssue),
      });

      const result = await adapter.getIssue({ issueKey: 'PROJ-123' });

      expect(result.key).toBe('PROJ-123');
      expect(result.title).toBe('The summary');
      expect(result.body).toBe('The description');
      expect(result.status).toBe('In Progress');
    });

    it('should handle fetch failures', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(adapter.getIssue({ issueKey: 'MISSING-1' })).rejects.toThrow(
        'Failed to fetch issue: Not Found'
      );
    });
  });
});
