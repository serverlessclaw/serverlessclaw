/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ITool, ToolType, JsonSchema } from '../types/index';
import { logger } from '../logger';
import { MCPClientManager } from './client-manager';
import { jsonSchemaToZod } from '../utils/zod-utils';

/**
 * Maps raw MCP tools to ServerlessClaw ITool interface.
 */
export class MCPToolMapper {
  static mapTools(serverName: string, client: Client, rawTools: unknown[]): ITool[] {
    return rawTools.map((mcpTool) =>
      this.mapMcpTool(serverName, mcpTool as any, async () => client)
    );
  }

  /**
   * Maps cached MCP tools without an active client.
   * Connection is deferred until execution.
   */
  static mapCachedTools(
    serverName: string,
    rawTools: unknown[],
    clientProvider: () => Promise<Client>
  ): ITool[] {
    return rawTools.map((mcpTool) => this.mapMcpTool(serverName, mcpTool as any, clientProvider));
  }

  /**
   * Core mapping logic shared between live and cached discovery.
   */

  private static mapMcpTool(
    serverName: string,
    mcpTool: any,
    clientProvider: () => Promise<Client>
  ): ITool {
    const isFilesystemTool = serverName === 'filesystem' || mcpTool.name.startsWith('filesystem_');
    const toolName = `${serverName}_${mcpTool.name}`;

    const parameters = (mcpTool.inputSchema as JsonSchema) || {
      type: 'object',
      properties: {},
    };

    // Filesystem path key discovery
    const pathKeys: string[] = [];
    if (parameters.type === 'object' && parameters.properties) {
      for (const [key, prop] of Object.entries(parameters.properties)) {
        const desc = (prop.description ?? '').toLowerCase();
        if (
          prop.type === 'string' &&
          (desc.includes('path') ||
            desc.includes('file') ||
            desc.includes('directory') ||
            desc.includes('dir'))
        ) {
          pathKeys.push(key);
        }
      }
    }

    return {
      name: toolName,
      description: mcpTool.description ?? `Tool from ${serverName} server.`,
      parameters,
      argSchema: jsonSchemaToZod(parameters),
      type: ToolType.MCP,
      connectionProfile: [],
      connector_id: '',
      auth: { type: 'api_key', resource_id: '' },
      requiresApproval: mcpTool.requiresApproval ?? false, // Defaults to false, overridden by executor if sensitive
      requiredPermissions: mcpTool.requiredPermissions ?? [],
      sequential: isFilesystemTool, // Filesystem operations usually need to be sequential
      pathKeys: pathKeys.length > 0 ? pathKeys : undefined,
      execute: async (toolArgs: Record<string, unknown>) => {
        try {
          const client = await clientProvider();
          const { withMCPResilience, isConnectionError } =
            await import('../lifecycle/error-recovery');
          return await withMCPResilience(
            toolName,
            async () => {
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: toolArgs,
              });
              return JSON.stringify(result.content);
            },
            {
              onFailure: (execError: Error) => {
                if (isConnectionError(execError)) {
                  logger.info(
                    `[MCP] Resetting client for ${serverName} due to connection error: ${execError.message}`
                  );
                  MCPClientManager.deleteClient(serverName);
                }
              },
            }
          );
        } catch (execError: unknown) {
          logger.error(
            `MCP Tool Execution Error (${serverName}:${mcpTool.name}):`,
            execError instanceof Error ? execError.message : String(execError)
          );
          throw execError;
        }
      },
    };
  }
}
