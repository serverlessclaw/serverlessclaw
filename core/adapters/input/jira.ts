import { z } from 'zod';
import { InputAdapter, InboundMessage } from './types';
import { IssueTrackerAction } from '../actions';
import { logger } from '../../lib/logger';

const JiraWebhookSchema = z.object({
  webhookEvent: z.string().optional(),
  issue: z
    .object({
      id: z.string().optional(),
      key: z.string().optional(),
      self: z.string().optional(),
      fields: z
        .object({
          summary: z.string(),
          description: z.string().nullable().optional(),
          status: z
            .object({
              name: z.string(),
            })
            .optional(),
          assignee: z
            .object({
              displayName: z.string(),
              emailAddress: z.string().optional(),
            })
            .nullable()
            .optional(),
          reporter: z
            .object({
              displayName: z.string(),
              emailAddress: z.string().optional(),
            })
            .optional(),
          priority: z
            .object({
              name: z.string(),
            })
            .optional(),
          issuetype: z
            .object({
              name: z.string(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  user: z
    .object({
      displayName: z.string(),
      emailAddress: z.string().optional(),
    })
    .optional(),
  comment: z
    .object({
      body: z.string(),
      author: z
        .object({
          displayName: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export class JiraAdapter implements InputAdapter, IssueTrackerAction {
  readonly source = 'jira';
  private readonly webhookSecret: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly email: string | undefined;
  private readonly apiToken: string | undefined;

  constructor(options?: {
    webhookSecret?: string;
    baseUrl?: string;
    email?: string;
    apiToken?: string;
  }) {
    this.webhookSecret = options?.webhookSecret ?? process.env.JIRA_WEBHOOK_SECRET;
    this.baseUrl = options?.baseUrl ?? process.env.JIRA_BASE_URL;
    this.email = options?.email ?? process.env.JIRA_EMAIL;
    this.apiToken = options?.apiToken ?? process.env.JIRA_API_TOKEN;
  }

  /**
   * Verifies the Jira webhook secret.
   * Jira often uses a secret as a query parameter or a custom header.
   */
  verifySecret(headers: Record<string, string>, query: Record<string, string>): boolean {
    if (!this.webhookSecret) {
      logger.warn('Jira webhook secret not configured, skipping verification');
      return true;
    }

    const secretFromHeader = headers['x-jira-webhook-secret'] || headers['X-Jira-Webhook-Secret'];
    const secretFromQuery = query['secret'];

    if (secretFromHeader === this.webhookSecret || secretFromQuery === this.webhookSecret) {
      return true;
    }

    logger.error('Jira webhook secret verification failed');
    return false;
  }

  parse(raw: unknown): InboundMessage {
    let body: unknown;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error('Invalid JSON format');
      }
    } else if (typeof raw === 'object' && raw !== null && 'body' in raw) {
      // Handle API Gateway event objects
      const event = raw as {
        body?: string;
        headers?: Record<string, string>;
        queryStringParameters?: Record<string, string>;
      };
      if (!event.body) throw new Error('Missing body in event');

      // Verify secret if enabled
      if (this.webhookSecret) {
        if (!this.verifySecret(event.headers ?? {}, event.queryStringParameters ?? {})) {
          throw new Error('Unauthorized Jira webhook');
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

    const result = JiraWebhookSchema.safeParse(body);
    if (!result.success) {
      logger.error('Jira schema validation failed:', result.error.format());
      throw new Error(`Invalid Jira webhook payload: ${result.error.message}`);
    }

    const parsed = result.data;
    const userId =
      parsed.user?.displayName ??
      parsed.issue?.fields?.reporter?.displayName ??
      parsed.comment?.author?.displayName ??
      'jira-unknown';

    const issueKey = parsed.issue?.key ?? 'unknown-issue';
    const sessionId = `jira-${issueKey}`;

    let text = '';
    const metadata: Record<string, unknown> = {
      jiraWebhookEvent: parsed.webhookEvent,
      issue: parsed.issue
        ? {
            id: parsed.issue.id,
            key: parsed.issue.key,
            summary: parsed.issue.fields?.summary,
            status: parsed.issue.fields?.status?.name,
            priority: parsed.issue.fields?.priority?.name,
            type: parsed.issue.fields?.issuetype?.name,
          }
        : undefined,
    };

    if (parsed.issue?.fields) {
      const summary = parsed.issue.fields.summary;
      const description = parsed.issue.fields.description ?? '';
      const status = parsed.issue.fields.status?.name;

      if (parsed.comment) {
        text = `Comment on ${issueKey}: ${parsed.comment.body}`;
        metadata.comment = {
          body: parsed.comment.body,
          author: parsed.comment.author?.displayName,
        };
      } else {
        text = `Issue ${issueKey}: ${summary}\nStatus: ${status ?? 'unknown'}\n${description}`;
      }
    }

    if (!text) {
      text = `Jira ${parsed.webhookEvent ?? 'unknown'} event from ${userId}`;
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

  async createIssue(options: {
    project?: string;
    title: string;
    body: string;
    issueType?: string;
    priority?: string;
  }): Promise<{ key: string; url: string }> {
    if (!this.baseUrl || !this.email || !this.apiToken) {
      throw new Error(
        'JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are required'
      );
    }

    if (!options.project) throw new Error('Project key is required for Jira issue creation');

    const response = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        fields: {
          project: { key: options.project },
          summary: options.title,
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: options.body,
                  },
                ],
              },
            ],
          },
          issuetype: { name: options.issueType ?? 'Task' },
          priority: options.priority ? { name: options.priority } : undefined,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Failed to create Jira issue:', error);
      throw new Error(`Failed to create issue: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      key: data.key,
      url: `${this.baseUrl}/browse/${data.key}`,
    };
  }

  async addComment(options: { issueKey?: string; body: string }): Promise<{ url: string }> {
    if (!this.baseUrl || !this.email || !this.apiToken) {
      throw new Error(
        'JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are required'
      );
    }

    if (!options.issueKey) throw new Error('Issue Key is required for Jira comments');

    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${options.issueKey}/comment`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: options.body,
                },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Failed to add Jira comment:', error);
      throw new Error(`Failed to add comment: ${response.statusText}`);
    }

    return { url: `${this.baseUrl}/browse/${options.issueKey}` };
  }

  async getIssue(options: {
    issueKey?: string;
  }): Promise<{ key: string; title: string; body: string; status: string }> {
    if (!this.baseUrl || !this.email || !this.apiToken) {
      throw new Error(
        'JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables are required'
      );
    }

    if (!options.issueKey) throw new Error('Issue Key is required for Jira issue fetching');

    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${options.issueKey}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch issue: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      key: data.key,
      title: data.fields.summary,
      body: data.fields.description?.content?.[0]?.content?.[0]?.text ?? '',
      status: data.fields.status?.name ?? 'unknown',
    };
  }
}
