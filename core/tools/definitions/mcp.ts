import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';

/**
 * MCP (Model Context Protocol) tool definitions.
 */
export const mcpTools: Record<string, IToolDefinition> = {
  registerMCPServer: {
    name: 'registerMCPServer',
    description: 'Registers a new Model Context Protocol (MCP) server for dynamic tool discovery.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        serverName: {
          type: TYPE_STRING,
          description: 'A unique name for the server (e.g., git, search).',
        },
        command: {
          type: TYPE_STRING,
          description: 'The command to run the server (e.g., npx @mcp/server-git).',
        },
        env: {
          type: TYPE_STRING,
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
      type: TYPE_OBJECT,
      properties: {
        serverName: {
          type: TYPE_STRING,
          description: 'The name of the MCP server to remove.',
        },
      },
      required: ['serverName'],
      additionalProperties: false,
    },
  },
};
