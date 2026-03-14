/**
 * UI-only shared types for dashboard components
 * Keep lightweight to avoid bundling server-only core code into the client.
 */
export interface Tool {
  name: string;
  description: string;
  isExternal?: boolean;
  usage?: {
    count: number;
    lastUsed: number;
  };
}
