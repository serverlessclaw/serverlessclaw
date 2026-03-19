import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ITool, JsonSchema } from '../types/index';
import { checkFileSecurity } from '../utils/fs-security';
import { logger } from '../logger';
import { MCPClientManager } from './client-manager';

/**
 * Maps raw MCP tools to ServerlessClaw ITool interface.
 */
export class MCPToolMapper {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static mapTools(serverName: string, client: Client, rawTools: any[]): ITool[] {
    return rawTools.map((mcpTool) => {
      const isFilesystemTool =
        serverName === 'filesystem' || mcpTool.name.startsWith('filesystem_');
      const toolName = `${serverName}_${mcpTool.name}`;

      const parameters = mcpTool.inputSchema as JsonSchema;
      if (isFilesystemTool && parameters.type === 'object' && parameters.properties) {
        parameters.properties.manuallyApproved = {
          type: 'boolean',
          description:
            'Must be true if modifying a protected system file, after explicit human approval.',
        };
      }

      return {
        name: toolName,
        description: mcpTool.description ?? `Tool from ${serverName} server.`,
        parameters,
        execute: async (toolArgs: Record<string, unknown>) => {
          if (isFilesystemTool) {
            const filePath = (toolArgs.path ||
              toolArgs.path_to_file ||
              toolArgs.file_path) as string;
            if (filePath) {
              const securityError = checkFileSecurity(
                filePath,
                toolArgs.manuallyApproved as boolean,
                `MCP operation (${mcpTool.name})`
              );
              if (securityError) return securityError;
            }
          }

          try {
            const result = await client.callTool({
              name: mcpTool.name,
              arguments: toolArgs,
            });
            return JSON.stringify(result.content);
          } catch (execError: unknown) {
            logger.error(
              `MCP Tool Execution Error (${serverName}:${mcpTool.name}):`,
              (execError as Error).message
            );
            if ((execError as Error)?.message?.includes('Connection closed')) {
              MCPClientManager.deleteClient(serverName);
            }
            throw execError;
          }
        },
      };
    });
  }
}
