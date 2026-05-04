import { z } from 'zod';
import { logger } from '../lib/logger';
import { GitHubAdapter } from '../adapters/input';
import { syncOrchestrator, fileSystemSyncLock } from '../lib/sync/orchestrator';
import { SyncOptions, SyncResult } from '../lib/types/sync';

const SyncWebhookPayloadSchema = z.object({
  action: z.string().optional(),
  issue: z
    .object({
      number: z.number(),
      title: z.string(),
      body: z.string().nullable(),
      labels: z.array(z.object({ name: z.string() })).optional(),
    })
    .optional(),
  repository: z
    .object({
      full_name: z.string(),
    })
    .optional(),
});

export interface SyncConfig {
  hubUrl: string;
  prefix?: string;
  method?: 'subtree' | 'fork';
  triggerLabels?: string[];
}

export class SyncWebhookHandler {
  private githubAdapter: GitHubAdapter;
  private config: SyncConfig;
  private triggerLabels: string[];

  constructor(config: SyncConfig) {
    this.githubAdapter = new GitHubAdapter() as unknown as GitHubAdapter;
    this.config = config;
    this.triggerLabels = config.triggerLabels || ['evolution-sync', 'evolution-contribution'];
  }

  async handleWebhook(event: unknown): Promise<{
    success: boolean;
    message: string;
    issueNumber?: number;
  }> {
    logger.info('[SyncWebhook] Processing webhook event');

    const parseResult = SyncWebhookPayloadSchema.safeParse(event);
    if (!parseResult.success) {
      return {
        success: false,
        message: `Invalid webhook payload: ${parseResult.error.message}`,
      };
    }

    const payload = parseResult.data;
    const action = payload.action;
    const issue = payload.issue;

    if (!issue) {
      return { success: false, message: 'No issue in payload' };
    }

    const issueLabels = issue.labels?.map((l) => l.name) || [];

    const shouldTrigger = this.triggerLabels.some((label) => issueLabels.includes(label));
    if (!shouldTrigger) {
      return {
        success: false,
        message: `Issue #${issue.number} does not have required sync labels`,
      };
    }

    if (action !== 'opened' && action !== 'labeled') {
      return {
        success: false,
        message: `Action '${action}' does not trigger sync`,
      };
    }

    logger.info(
      `[SyncWebhook] Triggering sync for issue #${issue.number} with labels: ${issueLabels.join(', ')}`
    );

    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      return { success: false, message: 'Repository not found in payload' };
    }

    const isContribution = issueLabels.includes('evolution-contribution');

    const syncOptions: SyncOptions = {
      hubUrl: this.config.hubUrl,
      prefix: this.config.prefix,
      method: this.config.method || 'subtree',
      commitMessage: `chore: sync from issue #${issue.number}`,
      gapIds: [`issue-${issue.number}`],
      lock: fileSystemSyncLock,
    };

    const verifyResult = await syncOrchestrator.verify(syncOptions);
    if (!verifyResult.ok) {
      await this.githubAdapter.addComment({
        repo: repoFullName,
        issueNumber: issue.number,
        body: `## Sync Verification Failed\n\n⚠️ ${verifyResult.message}\n\n---\n*Automated by ServerlessClaw Issue-Driven Sync*`,
      });
      return {
        success: false,
        message: verifyResult.message || 'Unknown verification error',
        issueNumber: issue.number,
      };
    }

    let result: SyncResult;
    if (isContribution) {
      result = await syncOrchestrator.push(syncOptions);
    } else {
      result = await syncOrchestrator.pull(syncOptions);
    }

    await this.githubAdapter.addComment({
      repo: repoFullName,
      issueNumber: issue.number,
      body: this.formatSyncResult(result),
    });

    return {
      success: result.success,
      message: result.message,
      issueNumber: issue.number,
    };
  }

  private formatSyncResult(result: SyncResult): string {
    const title = result.success ? '✅ Sync Successful' : '❌ Sync Failed';
    let body = `## ${title}\n\n${result.message}\n`;

    if (result.locked) {
      body += `\n⚠️ **Resource Locked**: Another synchronization is already in progress. Please wait a few minutes and try again.\n`;
    }

    if (result.commitHash) {
      body += `\n**Commit**: \`${result.commitHash}\`\n`;
    }

    if (result.conflicts && result.conflicts.length > 0) {
      body += `\n### ⚠️ Conflicts Detected\n\nThe following files require manual resolution:\n\n`;
      result.conflicts.forEach((c) => {
        body += `- \`${c.file}\`: ${c.description}\n`;
      });
      body += `\n**Instructions**: Please resolve these conflicts locally, commit the changes, and close this issue.\n`;
    }

    body += `\n---\n*Automated by ServerlessClaw Issue-Driven Sync*`;
    return body;
  }
}

export function createSyncWebhookHandler(config: SyncConfig): SyncWebhookHandler {
  return new SyncWebhookHandler(config);
}
