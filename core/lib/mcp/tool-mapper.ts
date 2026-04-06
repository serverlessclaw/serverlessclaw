/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ITool, ToolType, JsonSchema } from '../types/index';
import { checkFileSecurity } from '../utils/fs-security';
import { logger } from '../logger';
import { MCPClientManager } from './client-manager';

/**
 * Maps raw MCP tools to ServerlessClaw ITool interface.
 */
export class MCPToolMapper {
  static mapTools(serverName: string, client: Client, rawTools: any[]): ITool[] {
    return rawTools.map((mcpTool) => {
      const isFilesystemTool =
        serverName === 'filesystem' || mcpTool.name.startsWith('filesystem_');
      const toolName = `${serverName}_${mcpTool.name}`;

      const parameters = (mcpTool.inputSchema as JsonSchema) || {
        type: 'object',
        properties: {},
      };
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
        type: ToolType.MCP,
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
            const { withMCPResilience } = await import('../lifecycle/error-recovery');
            return await withMCPResilience(toolName, async () => {
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: toolArgs,
              });
              return JSON.stringify(result.content);
            });
          } catch (execError: unknown) {
            logger.error(
              `MCP Tool Execution Error (${serverName}:${mcpTool.name}):`,
              (execError as Error).message
            );
            if (this.isConnectionError(execError)) {
              MCPClientManager.deleteClient(serverName);
            }
            throw execError;
          }
        },
      };
    });
  }

  /**
   * Maps cached MCP tools without an active client.
   * Connection is deferred until execution.
   */
  static mapCachedTools(
    serverName: string,
    rawTools: any[],
    clientProvider: () => Promise<Client>
  ): ITool[] {
    return rawTools.map((mcpTool) => {
      const isFilesystemTool =
        serverName === 'filesystem' || mcpTool.name.startsWith('filesystem_');
      const toolName = `${serverName}_${mcpTool.name}`;

      const parameters = (mcpTool.inputSchema as JsonSchema) || {
        type: 'object',
        properties: {},
      };
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
        type: ToolType.MCP,
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
            const client = await clientProvider();
            const { withMCPResilience } = await import('../lifecycle/error-recovery');
            return await withMCPResilience(toolName, async () => {
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: toolArgs,
              });
              return JSON.stringify(result.content);
            });
          } catch (execError: unknown) {
            logger.error(
              `MCP Tool Execution Error (${serverName}:${mcpTool.name}):`,
              (execError as Error).message
            );
            if (this.isConnectionError(execError)) {
              MCPClientManager.deleteClient(serverName);
            }
            throw execError;
          }
        },
      };
    });
  }

  /**
   * Helper to identify connection-related errors.
   */
  private static isConnectionError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('connection') ||
        msg.includes('econnrefused') ||
        msg.includes('socket') ||
        msg.includes('closed') ||
        msg.includes('timeout')
      );
    }
    return false;
  }
}
