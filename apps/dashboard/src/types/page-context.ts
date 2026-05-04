/**
 * Shared types for page context capturing and propagation.
 */

export interface PageContextData {
  url: string;
  title?: string;
  data?: Record<string, unknown>;
  traceId?: string;
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
}
