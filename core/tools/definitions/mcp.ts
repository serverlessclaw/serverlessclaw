import { IToolDefinition } from '../../lib/types/index';

/**
 * MCP (Model Context Protocol) tool definitions.
 */
export const mcpTools: Record<string, IToolDefinition> = {
  registerMCPServer: {
    name: 'registerMCPServer',
    description: 'Registers a new Model Context Protocol (MCP) server for dynamic tool discovery.',
    parameters: {
      type: 'object',
      properties: {
        serverName: {
          type: 'string',
          description: 'A unique name for the server (e.g., git, search).',
        },
        command: {
          type: 'string',
          description: 'The command to run the server (e.g., npx @mcp/server-git).',
        },
        env: {
          type: 'string',
          description: 'Optional environment variables for the server (JSON stringified object).',
        },
      },
      required: ['serverName', 'command', 'env'],
      additionalProperties: false,
    },
  },
  unregisterMCPServer: {
    name: 'unregisterMCPServer',
    description: 'Removes an MCP server and all its associated tools from the system.',
    parameters: {
      type: 'object',
      properties: {
        serverName: {
          type: 'string',
          description: 'The name of the MCP server to remove.',
        },
      },
      required: ['serverName'],
      additionalProperties: false,
    },
  },
};
