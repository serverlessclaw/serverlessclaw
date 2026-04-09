import { SyncOptions, SyncMethod } from '@serverlessclaw/core/lib/types/sync';
import { syncOrchestrator } from '@serverlessclaw/core/lib/sync/orchestrator';
import { GitHubAdapter } from '../adapters/input/github-sensor';
import { execSync } from 'child_process';

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface ResolutionResult {
  success: boolean;
  message: string;
  filesChanged?: string[];
}

interface IssueSyncConfig {
  hubUrl: string;
  hubRepo?: string; // e.g., 'serverlessclaw/serverlessclaw'
  prefix?: string;
  method?: SyncMethod;
}

export class GitHubIssueResolverAgent {
  private llm: { generate: (prompt: string) => Promise<{ text: () => Promise<string> }> };
  private config: IssueSyncConfig;
  private githubAdapter: GitHubAdapter;

  constructor(llmProvider: any, config: IssueSyncConfig) {
    this.llm = llmProvider as {
      generate: (prompt: string) => Promise<{ text: () => Promise<string> }>;
    };
    this.config = config;
    this.githubAdapter = new GitHubAdapter();
  }

  async resolve(issue: GitHubIssue, workingDir: string): Promise<ResolutionResult> {
    console.log(`[IssueResolver] Resolving Issue #${issue.number}: ${issue.title}...`);

    const strategy = this.identifyStrategy(issue);
    console.log(`[IssueResolver] Selected Strategy: ${strategy}`);

    try {
      switch (strategy) {
        case 'CORE_EVOLUTION_SYNC':
          return await this.executeSubtreeSync(issue, workingDir);
        case 'EVOLUTION_CONTRIBUTION':
          return await this.applyContributionPattern(issue, workingDir);
        case 'BUG_FIX':
          return await this.applyAgenticPatch(issue, workingDir);
        default:
          return { success: false, message: `Unknown strategy: ${strategy}` };
      }
    } catch (error) {
      console.error(`[IssueResolver] Resolution failed: ${(error as Error).message}`);
      return { success: false, message: (error as Error).message };
    }
  }

  async verifySync(_workingDir: string): Promise<{ ok: boolean; message: string }> {
    const options: SyncOptions = {
      hubUrl: this.config.hubUrl,
      prefix: this.config.prefix,
      method: this.config.method || 'subtree',
      commitMessage: 'verify-sync',
    };

    const result = await syncOrchestrator.verify(options);
    return {
      ok: result.ok,
      message: result.message || 'Verification complete',
    };
  }

  private identifyStrategy(issue: GitHubIssue): string {
    if (issue.labels.includes('evolution-sync')) return 'CORE_EVOLUTION_SYNC';
    if (issue.labels.includes('evolution-contribution')) return 'EVOLUTION_CONTRIBUTION';
    if (issue.labels.includes('bug')) return 'BUG_FIX';
    return 'UNKNOWN';
  }

  private async executeSubtreeSync(
    issue: GitHubIssue,
    _workingDir: string
  ): Promise<ResolutionResult> {
    const hubVersion = this.extractVersion(issue.body);
    console.log(`[IssueResolver] Syncing with Hub version: ${hubVersion}...`);

    const options: SyncOptions = {
      hubUrl: this.config.hubUrl,
      prefix: this.config.prefix || 'core/',
      method: this.config.method || 'subtree',
      commitMessage: `chore: sync with hub via issue #${issue.number} (${hubVersion})`,
      gapIds: [`issue-${issue.number}`],
    };

    const verifyResult = await syncOrchestrator.verify(options);
    if (!verifyResult.canSyncWithoutConflict) {
      return {
        success: false,
        message: `Cannot sync: conflicts detected - ${verifyResult.message}`,
      };
    }

    const pullResult = await syncOrchestrator.pull(options);

    if (pullResult.success) {
      return {
        success: true,
        message: `Successfully synced to Hub v${hubVersion}. Commit: ${pullResult.commitHash}`,
        filesChanged: pullResult.conflicts?.map((c) => c.file),
      };
    }

    return {
      success: false,
      message: `Sync failed: ${pullResult.message}`,
    };
  }

  private async applyContributionPattern(
    issue: GitHubIssue,
    _workingDir: string
  ): Promise<ResolutionResult> {
    console.log(`[IssueResolver] Generating lightweight evolutionary proposal for Mother Hub...`);

    if (!this.config.hubRepo) {
      return {
        success: false,
        message: 'Hub repository (hubRepo) not configured. Cannot raise contribution issue.',
      };
    }

    if (!this.llm) {
      return {
        success: false,
        message: 'No LLM provider configured for proposal generation',
      };
    }

    // 1. Identify what changed in the local 'spoke' relative to the hub
    const hubRemote = 'hub-origin';
    const prefix = this.config.prefix || 'core/';
    let localDiff = '';
    try {
      localDiff = execSync(`git diff ${hubRemote}/main...HEAD -- ${prefix}`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB limit
      });
    } catch {
      console.warn('[IssueResolver] Could not get git diff, falling back to issue context only.');
    }

    // 2. Generate an abstract, non-proprietary proposal using LLM
    const prompt = `
      You are an Evolution Facilitator for ServerlessClaw. 
      A Spoke repository has an innovation or fix tagged as 'evolution-contribution'.
      
      Spoke Issue: #${issue.number} - ${issue.title}
      Description: ${issue.body}
      
      Local Diff (if available):
      ${localDiff.substring(0, 5000)} // Truncated to save tokens
      
      TASK:
      Create a high-level, lightweight "Evolutionary Proposal" for the Mother Hub.
      - DO NOT include PII, client names, or proprietary 'clawmore' secrets.
      - Describe the ARCHITECTURAL change or FEATURE.
      - Keep it concise to minimize token usage.
      - Focus on the "Why" and the "How (Conceptual)".
      
      Format your response as:
      Title: [PROPOSAL] Short description
      Body: Detailed but concise blueprint for the Hub owner.
    `;

    const response = await this.llm.generate(prompt);
    const proposalText = await response.text();

    const titleMatch = proposalText.match(/Title:\s*(.*)/);
    const bodyMatch = proposalText.match(/Body:\s*([\s\S]*)/);

    const hubTitle = titleMatch ? titleMatch[1].trim() : `[CONTRIB] ${issue.title}`;
    const hubBody = bodyMatch
      ? bodyMatch[1].trim()
      : `Original Issue: ${issue.title}\n\n${proposalText}`;

    // 3. Create issue on the Mother Hub
    try {
      const hubIssue = await this.githubAdapter.createIssue({
        repo: this.config.hubRepo,
        title: hubTitle,
        body: `${hubBody}\n\n---\n*Origin: Spoke Issue #${issue.number}*`,
        labels: ['evolution-review', 'spoke-contribution'],
      });

      return {
        success: true,
        message: `Evolutionary proposal raised on Mother Hub: ${hubIssue.url}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to raise proposal on Hub: ${message}`,
      };
    }
  }

  private async applyAgenticPatch(
    issue: GitHubIssue,
    _workingDir: string
  ): Promise<ResolutionResult> {
    console.log(`[IssueResolver] Generating agentic patch for bug report...`);

    if (!this.llm) {
      return {
        success: false,
        message: 'No LLM provider configured for agentic patch generation',
      };
    }

    const prompt = `
      Analyze this bug report and generate a patch:
      
      Issue #${issue.number}: ${issue.title}
      Description: ${issue.body}
      
      Generate a diff/patch to fix this bug. Return the patch in unified diff format.
    `;

    const response = await this.llm.generate(prompt);
    const patchText = await response.text();

    console.log(`[IssueResolver] Generated patch (${patchText.length} chars)`);

    return {
      success: true,
      message: `Bug fix patch generated for issue #${issue.number}. Manual review required.`,
    };
  }

  private extractVersion(body: string): string {
    const match = body.match(/v\d+\.\d+\.\d+/);
    return match ? match[0] : 'main';
  }
}
