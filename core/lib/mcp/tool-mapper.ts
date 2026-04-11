/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ITool, ToolType, JsonSchema, ToolResult, createToolResult } from '../types/index';
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
        const lowKey = key.toLowerCase();
        if (
          prop.type === 'string' &&
          (desc.includes('path') ||
            desc.includes('file') ||
            desc.includes('directory') ||
            desc.includes('dir') ||
            desc.includes('folder') ||
            lowKey.includes('path') ||
            lowKey.includes('file') ||
            lowKey.includes('dir') ||
            lowKey === 'src' ||
            lowKey === 'dest' ||
            lowKey === 'source' ||
            lowKey === 'destination')
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
              return this.parseMcpToolResult(result);
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

  /**
   * Parses MCP callTool result into a structured ToolResult.
   * Handles TextContent, ImageContent, and other content types.
   */
  private static parseMcpToolResult(result: unknown): ToolResult {
    const images: string[] = [];
    let text = '';
    const metadata: Record<string, unknown> = {};

    const content = (result as { content?: unknown[] })?.content;

    if (content && Array.isArray(content)) {
      for (const item of content) {
        const itemAny = item as Record<string, unknown>;
        const itemType = itemAny.type as string | undefined;

        if (itemType === 'text' || itemType === 'resource' || !itemType) {
          const itemText = itemAny.text as string | undefined;
          if (itemText) text += itemText;
        } else if (itemType === 'image') {
          const imageData = itemAny.data as string | undefined;
          if (imageData) {
            images.push(imageData);
            metadata.imageMimeType = itemAny.mimeType;
          }
        } else {
          metadata[itemType] = item;
        }
      }
    }

    return createToolResult(text || 'MCP tool executed successfully', {
      images: images.length > 0 ? images : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }
}
