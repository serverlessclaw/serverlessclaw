/**
 * Knowledge tools module - re-exports from specialized submodules.
 * Split into:
 * - knowledge-agent.ts: Agent management, dispatch, tools config, system config, clarification
 * - knowledge-storage.ts: Memory storage, retrieval, gaps, skills discovery
 * - knowledge-mcp.ts: MCP server registration and management
 */

/**
 * Utility function to format error messages consistently.
 * Converts error to string message, handling both Error objects and other types.
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Re-export from submodules for backward compatibility
export * from './knowledge-agent';
export * from './knowledge-storage';
export * from './knowledge-mcp';
