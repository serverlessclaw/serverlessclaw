import { knowledgeSchema } from './schema';
import { ConfigManager } from '../../lib/registry/config';
import { formatErrorMessage } from '../../lib/utils/error';

import { MCPServerConfig } from '../../lib/types/mcp';

/**
 * Registers a new MCP server in the global configuration.
 */
export const registerMCPServer = {
  ...knowledgeSchema.registerMCPServer,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      serverName,
      type = 'local',
      command,
      url,
      connector_id,
      env,
    } = args as {
      serverName: string;
      type?: 'local' | 'remote' | 'managed';
      command?: string;
      url?: string;
      connector_id?: string;
      env?: string;
    };

    try {
      const mcpServers =
        ((await ConfigManager.getRawConfig('mcp_servers')) as Record<string, unknown>) ?? {};

      let config: MCPServerConfig;

      if (type === 'local') {
        if (!command) return 'FAILED: "command" is required for local MCP servers.';
        let parsedEnv = {};
        if (env) {
          try {
            parsedEnv = typeof env === 'string' ? JSON.parse(env) : env;
          } catch {
            return 'FAILED: Failed to parse environment variables. Ensure "env" is a valid JSON string.';
          }
        }
        config = { type: 'local', command, env: parsedEnv };
      } else if (type === 'remote') {
        if (!url) return 'FAILED: "url" is required for remote MCP servers.';
        config = { type: 'remote', url };
      } else if (type === 'managed') {
        if (!connector_id) return 'FAILED: "connector_id" is required for managed MCP servers.';
        config = { type: 'managed', connector_id };
      } else {
        return `FAILED: Unsupported MCP server type "${type}".`;
      }

      mcpServers[serverName] = config;
      await ConfigManager.saveRawConfig('mcp_servers', mcpServers);

      return `Successfully registered ${type} MCP server '${serverName}'.`;
    } catch (error) {
      return `Failed to register MCP server: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Removes an MCP server and its associated tools.
 */
export const unregisterMCPServer = {
  ...knowledgeSchema.unregisterMCPServer,
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

/**
 * Retrieves the current Model Context Protocol (MCP) servers configuration.
 */
export const getMcpConfig = {
  ...knowledgeSchema.getMcpConfig,
  execute: async (): Promise<string> => {
    try {
      const mcpServers =
        ((await ConfigManager.getRawConfig('mcp_servers')) as Record<string, unknown>) ?? {};

      return JSON.stringify(mcpServers, null, 2);
    } catch (error) {
      return `Failed to get MCP configuration: ${formatErrorMessage(error)}`;
    }
  },
};
