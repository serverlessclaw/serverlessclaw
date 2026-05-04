export * from '@serverlessclaw/core/lib/types/input';

export interface IssueTrackerAction {
  createIssue(options: {
    repo?: string;
    project?: string;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<{ key?: string; number?: number; url: string }>;

  addComment(options: {
    repo?: string;
    issueNumber?: number;
    issueKey?: string;
    body: string;
  }): Promise<{ url: string }>;

  getIssue(options: { repo?: string; issueNumber?: number; issueKey?: string }): Promise<{
    title: string;
    body: string;
    state?: string;
    status?: string;
    labels?: string[];
  }>;
}
