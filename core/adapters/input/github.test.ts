import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAdapter } from './github';
import crypto from 'crypto';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GitHubAdapter', () => {
  const secret = 'test-secret';
  const token = 'test-token';
  const repo = 'org/repo';

  let adapter: GitHubAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitHubAdapter({
      webhookSecret: secret,
      apiToken: token,
    });
    global.fetch = vi.fn();
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', () => {
      const payload = '{"action":"opened"}';
      const hmac = crypto.createHmac('sha256', secret);
      const signature = 'sha256=' + hmac.update(payload).digest('hex');
      expect(adapter.verifySignature(payload, signature)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const payload = 'payload';
      const signature = 'sha256=wrong';
      expect(adapter.verifySignature(payload, signature)).toBe(false);
    });

    it('should return false if signature is missing but secret is configured', () => {
      expect(adapter.verifySignature('payload', '')).toBe(false);
    });

    it('should return true if no secret configured', () => {
      const noSecretAdapter = new GitHubAdapter({});
      expect(noSecretAdapter.verifySignature('payload', 'any')).toBe(true);
    });
  });

  describe('parse', () => {
    it('should parse an issue opened event via API Gateway', () => {
      const body = {
        action: 'opened',
        issue: {
          number: 42,
          title: 'Bug: Something broken',
          body: 'Here is the description',
          user: { login: 'dev123' },
        },
        repository: { full_name: repo },
        sender: { login: 'dev123' },
      };

      const payload = JSON.stringify(body);
      // Recalculated signature for EXACT payload string
      const hmac = crypto.createHmac('sha256', secret);
      const signature = 'sha256=' + hmac.update(payload).digest('hex');

      const event = {
        body: payload,
        headers: {
          'x-hub-signature-256': signature,
          'x-github-event': 'issues',
        },
      };

      const result = adapter.parse(event);
      expect(result.source).toBe('github');
      expect(result.userId).toBe('dev123');
      expect(result.text).toContain('Issue #42: Bug: Something broken');
      expect(result.metadata.githubEventType).toBe('issues');
    });

    it('should parse a pull request event', () => {
      const body = {
        action: 'opened',
        pull_request: {
          number: 101,
          title: 'Feat: Add something',
          body: 'PR description',
          user: { login: 'coder456' },
          state: 'open',
        },
        repository: { full_name: repo },
        sender: { login: 'coder456' },
      };

      const result = adapter.parse(body);
      expect(result.text).toContain('PR #101: Feat: Add something');
      expect(result.userId).toBe('coder456');
    });

    it('should parse a comment event', () => {
      const body = {
        action: 'created',
        comment: {
          body: 'Great PR!',
          user: { login: 'reviewer1' },
        },
        repository: { full_name: repo },
        sender: { login: 'reviewer1' },
      };

      const result = adapter.parse(body);
      expect(result.text).toBe('Great PR!');
      expect(result.userId).toBe('reviewer1');
    });

    it('should throw on invalid JSON', () => {
      expect(() => adapter.parse('invalid')).toThrow('Invalid JSON payload');
    });

    it('should throw on invalid schema', () => {
      expect(() => adapter.parse({ issue: 'not-an-object' })).toThrow(
        /Invalid GitHub webhook payload/
      );
    });
  });

  describe('createIssue', () => {
    it('should successfully create an issue', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ number: 5, html_url: 'https://github.com/org/repo/issues/5' }),
      });

      const result = await adapter.createIssue({
        repo,
        title: 'New bug',
        body: 'Desc',
      });

      expect(result.number).toBe(5);
      expect(result.url).toBe('https://github.com/org/repo/issues/5');
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.github.com/repos/${repo}/issues`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw if token is missing', async () => {
      const badAdapter = new GitHubAdapter({});
      await expect(badAdapter.createIssue({ title: 'x', body: 'y' })).rejects.toThrow(
        'GITHUB_TOKEN environment variable is required'
      );
    });

    it('should throw if repo is missing', async () => {
      await expect(adapter.createIssue({ title: 'x', body: 'y' })).rejects.toThrow(
        'Repository is required'
      );
    });
  });

  describe('addComment', () => {
    it('should successfully add a comment', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ html_url: 'https://github.com/comment/1' }),
      });

      const result = await adapter.addComment({
        repo,
        issueNumber: 42,
        body: 'Approved',
      });

      expect(result.url).toBe('https://github.com/comment/1');
    });
  });

  describe('getIssue', () => {
    it('should successfully fetch an issue', async () => {
      const mockIssue = {
        title: 'The Issue',
        body: 'The Body',
        state: 'open',
        labels: [{ name: 'bug' }],
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIssue),
      });

      const result = await adapter.getIssue({ repo, issueNumber: 42 });

      expect(result.title).toBe('The Issue');
      expect(result.labels).toEqual(['bug']);
    });
  });
});
