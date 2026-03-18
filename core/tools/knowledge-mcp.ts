import { toolDefinitions } from './definitions';
import { ConfigManager } from '../lib/registry/config';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * Registers a new MCP server in the global configuration.
 */
export const registerMCPServer = {
  ...toolDefinitions.registerMCPServer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { serverName, command, env } = args as {
      serverName: string;
      command: string;
      env: string;
    };

    try {
      let parsedEnv = {};
      if (env) {
        try {
          parsedEnv = typeof env === 'string' ? JSON.parse(env) : env;
        } catch {
          return `Failed to parse environment variables. Ensure 'env' is a valid JSON string.`;
        }
      }

      const mcpServers =
        ((await ConfigManager.getRawConfig('mcp_servers')) as Record<string, unknown>) ?? {};
      mcpServers[serverName] = { command, env: parsedEnv };

      await ConfigManager.saveRawConfig('mcp_servers', mcpServers);
      return `Successfully registered MCP server '${serverName}'.`;
    } catch (error) {
      return `Failed to register MCP server: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Removes an MCP server and its associated tools.
 */
export const unregisterMCPServer = {
  ...toolDefinitions.unregisterMCPServer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { serverName } = args as { serverName: string };

    try {
      const mcpServers =
        ((await ConfigManager.getRawConfig('mcp_servers')) as Record<string, unknown>) ?? {};

      if (!mcpServers[serverName]) return `FAILED: MCP server '${serverName}' is not registered.`;

      delete mcpServers[serverName];
      await ConfigManager.saveRawConfig('mcp_servers', mcpServers);

      return `Successfully unregistered MCP server '${serverName}'.`;
    } catch (error) {
      return `Failed to unregister MCP server: ${formatErrorMessage(error)}`;
    }
  },
};
