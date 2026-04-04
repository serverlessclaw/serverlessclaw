/**
 * Interface for issue tracking actions across different platforms (GitHub, Jira, etc.).
 * Separates outbound system actions from inbound message parsing.
 */
export interface IssueTrackerAction {
  /**
   * Creates a new issue on the platform.
   */
  createIssue(options: {
    repo?: string;
    project?: string;
    title: string;
    body: string;
    labels?: string[];
    issueType?: string;
    priority?: string;
  }): Promise<{ key?: string; number?: number; url: string }>;

  /**
   * Adds a comment to an existing issue.
   */
  addComment(options: {
    repo?: string;
    issueNumber?: number;
    issueKey?: string;
    body: string;
  }): Promise<{ url: string }>;

  /**
   * Fetches the details of an existing issue.
   */
  getIssue(options: { repo?: string; issueNumber?: number; issueKey?: string }): Promise<{
    title: string;
    body: string;
    state?: string;
    status?: string;
    labels?: string[];
  }>;
}
