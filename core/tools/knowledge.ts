/**
 * Knowledge tools module - re-exports from specialized submodules.
 * Split into:
 * - knowledge-agent.ts: Agent management, dispatch, tools config, system config, clarification
 * - knowledge-storage.ts: Memory storage, retrieval, gaps, skills discovery
 * - knowledge-mcp.ts: MCP server registration and management
 */

// Re-export centralized error utility for backward compatibility
export { formatErrorMessage, formatPrefixedError } from '../lib/utils/error';

// Re-export from submodules for backward compatibility
export * from './knowledge-agent';
export * from './knowledge-storage';
export * from './knowledge-mcp';
