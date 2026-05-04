import { JsonSchema } from './tool';

/**
 * Configuration for an MCP Server connection.
 */
export type MCPServerConfig = LocalMCPServerConfig | RemoteMCPServerConfig | ManagedMCPServerConfig;

/**
 * A local MCP server started via a shell command (e.g., npx).
 */
export interface LocalMCPServerConfig {
  type: 'local';
  /** The shell command to start the server. */
  command: string;
  /** Optional environment variables for the server process. */
  env?: Record<string, string>;
}

/**
 * A remote MCP server connected via SSE.
 */
export interface RemoteMCPServerConfig {
  type: 'remote';
  /** The URL of the remote MCP server. */
  url: string;
}

/**
 * A managed MCP connector (e.g., OpenAI Managed Connectors).
 */
export interface ManagedMCPServerConfig {
  type: 'managed';
  /** The unique identifier for the connector (e.g., connector_googledrive). */
  connector_id: string;
  /** Optional human-readable name for the tool. */
  name?: string;
  /** Optional description for the tool. */
  description?: string;
  /** Optional schema for the tool parameters. */
  parameters?: JsonSchema;
}
