import { z } from 'zod';
import { InputAdapter, InboundMessage, IssueTrackerAction } from '../types';
import { logger } from '../lib/logger';
import { verifyHmacSignature } from '../utils/webhook';

const GitHubWebhookSchema = z.object({
  action: z.string().optional(),
  issue: z
    .object({
      number: z.number(),
      title: z.string(),
      body: z.string().nullable().optional(),
      user: z.object({ login: z.string() }).optional(),
      labels: z.array(z.object({ name: z.string() })).optional(),
    })
    .optional(),
  pull_request: z
    .object({
      number: z.number(),
      title: z.string(),
      body: z.string().nullable().optional(),
      user: z.object({ login: z.string() }).optional(),
      state: z.string().optional(),
    })
    .optional(),
  comment: z
    .object({
      body: z.string(),
      user: z.object({ login: z.string() }).optional(),
    })
    .optional(),
  repository: z
    .object({
      full_name: z.string(),
      html_url: z.string().optional(),
    })
    .optional(),
  sender: z
    .object({
      login: z.string(),
    })
    .optional(),
});

export class GitHubAdapter implements InputAdapter, IssueTrackerAction {
  readonly source = 'github';
  readonly version = '1.0.0';
  private readonly webhookSecret: string | undefined;
  private readonly apiToken: string | undefined;

  constructor(options?: { webhookSecret?: string; apiToken?: string }) {
    this.webhookSecret = options?.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET;
    this.apiToken = options?.apiToken ?? process.env.GITHUB_TOKEN;
  }

  /**
   * Verifies the GitHub webhook signature.
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn('GitHub webhook secret not configured, skipping verification');
      return true;
    }

    if (!verifyHmacSignature(payload, signature, this.webhookSecret)) {
      logger.error('Invalid X-Hub-Signature-256 header or signature mismatch');
      return false;
    }

    return true;
  }

  parse(raw: unknown): InboundMessage {
    let body: unknown;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error('Invalid JSON payload');
      }
    } else if (typeof raw === 'object' && raw !== null && 'body' in raw) {
      // Handle API Gateway event objects
      const event = raw as { body?: string; headers?: Record<string, string> };
      if (!event.body) throw new Error('Missing body in event');

      // Verify signature if secret is present
      const signature =
        event.headers?.['x-hub-signature-256'] || event.headers?.['X-Hub-Signature-256'];
      if (this.webhookSecret && signature) {
        if (!this.verifySignature(event.body, signature)) {
          throw new Error('Invalid GitHub signature');
        }
      }

      try {
        body = JSON.parse(event.body);
      } catch {
        throw new Error('Invalid JSON in event body');
      }
    } else {
      body = raw;
    }

    const result = GitHubWebhookSchema.safeParse(body);
    if (!result.success) {
      logger.error('GitHub schema validation failed:', result.error.format());
      throw new Error(`Invalid GitHub webhook payload: ${result.error.message}`);
    }

    const parsed = result.data;
    const eventType = this.getEventType(raw);
    const userId =
      parsed.sender?.login ??
      parsed.issue?.user?.login ??
      parsed.pull_request?.user?.login ??
      'github-unknown';
    const repoName = parsed.repository?.full_name ?? 'unknown-repo';
    const sessionId = `${repoName}-${userId}`;

    let text = '';
    const metadata: Record<string, unknown> = {
      githubEventType: eventType,
      action: parsed.action,
      repository: parsed.repository,
    };

    if (parsed.issue) {
      metadata.issue = {
        number: parsed.issue.number,
        title: parsed.issue.title,
        labels: parsed.issue.labels,
      };
      text = `Issue #${parsed.issue.number}: ${parsed.issue.title}\n${parsed.issue.body ?? ''}`;
    }

    if (parsed.pull_request) {
      metadata.pullRequest = {
        number: parsed.pull_request.number,
        title: parsed.pull_request.title,
        state: parsed.pull_request.state,
      };
      text = `PR #${parsed.pull_request.number}: ${parsed.pull_request.title}\n${parsed.pull_request.body ?? ''}`;
    }

    if (parsed.comment) {
      metadata.comment = {
        user: parsed.comment.user?.login,
      };
      text = parsed.comment.body;
    }

    if (!text) {
      text = `GitHub ${eventType} event from ${userId}`;
    }

    return {
      source: this.source,
      userId,
      sessionId,
      text,
      attachments: [],
      metadata,
      timestamp: new Date().toISOString(),
    };
  }

  private getEventType(raw: unknown): string {
    if (typeof raw === 'object' && raw !== null && 'headers' in raw) {
      const headers = (raw as Record<string, Record<string, string>>).headers;
      return headers['x-github-event'] ?? headers['X-GitHub-Event'] ?? 'unknown';
    }
    return 'webhook';
  }

  async createIssue(options: {
    repo?: string;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<{ number: number; url: string }> {
    if (!this.apiToken) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    if (!options.repo) throw new Error('Repository is required for GitHub issue creation');

    const response = await fetch(`https://api.github.com/repos/${options.repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        labels: options.labels,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Failed to create GitHub issue:', error);
      throw new Error(`Failed to create issue: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      number: data.number,
      url: data.html_url,
    };
  }

  async addComment(options: {
    repo?: string;
    issueNumber?: number;
    body: string;
  }): Promise<{ url: string }> {
    if (!this.apiToken) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    if (!options.repo || !options.issueNumber) {
      throw new Error('Repository and Issue Number are required for GitHub comments');
    }

    const response = await fetch(
      `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: options.body }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error('Failed to add GitHub comment:', error);
      throw new Error(`Failed to add comment: ${response.statusText}`);
    }

    const data = await response.json();
    return { url: data.html_url };
  }

  async getIssue(options: {
    repo?: string;
    issueNumber?: number;
  }): Promise<{ title: string; body: string; state: string; labels: string[] }> {
    if (!this.apiToken) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    if (!options.repo || !options.issueNumber) {
      throw new Error('Repository and Issue Number are required for GitHub issue fetching');
    }

    const response = await fetch(
      `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch issue: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      title: data.title,
      body: data.body ?? '',
      state: data.state,
      labels: data.labels?.map((l: { name: string }) => l.name) ?? [],
    };
  }
}
