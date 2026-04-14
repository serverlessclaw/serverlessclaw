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
    const isSequentialTool =
      serverName === 'filesystem' ||
      serverName === 'git' ||
      mcpTool.name.startsWith('filesystem_') ||
      mcpTool.name.startsWith('git_');
    const toolName = `${serverName}_${mcpTool.name}`;

    const parameters = (mcpTool.inputSchema as JsonSchema) || {
      type: 'object',
      properties: {},
    };

    // Filesystem path key discovery - handles both string and string[] types
    const pathKeys: string[] = [];
    if (parameters.type === 'object' && parameters.properties) {
      for (const [key, prop] of Object.entries(parameters.properties)) {
        const desc = (prop.description ?? '').toLowerCase();
        const lowKey = key.toLowerCase();
        const propType = prop.type as string;

        // Check if this is a path-like property (string or string[] type)
        const isPathLikeString =
          propType === 'string' &&
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
            lowKey === 'destination');

        // Also check for array of strings (e.g., paths: string[], files: string[])
        const isPathLikeArray =
          propType === 'array' &&
          prop.items &&
          ((prop.items as JsonSchema).type === 'string' ||
            (Array.isArray(prop.items) &&
              prop.items.some((item: JsonSchema) => item.type === 'string'))) &&
          (desc.includes('path') ||
            desc.includes('file') ||
            desc.includes('directory') ||
            desc.includes('files') ||
            desc.includes('paths') ||
            lowKey.includes('path') ||
            lowKey.includes('file') ||
            lowKey.endsWith('s')); // plural form like "paths", "files"

        if (isPathLikeString || isPathLikeArray) {
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
      sequential: isSequentialTool, // Filesystem and Git operations usually need to be sequential
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
   * Handles TextContent, ImageContent, and other content types with high fidelity.
   */
  private static parseMcpToolResult(result: unknown): ToolResult {
    const res = result as { content?: unknown[]; isError?: boolean };
    const images: string[] = [];
    const resources: Array<{ uri: string; text?: string; mimeType?: string }> = [];
    let text = '';
    const metadata: Record<string, unknown> = {};

    const content = res.content;

    if (content && Array.isArray(content)) {
      for (const item of content) {
        const itemAny = item as Record<string, unknown>;
        const itemType = itemAny.type as string | undefined;

        if (itemType === 'text' || !itemType) {
          const itemText = itemAny.text as string | undefined;
          if (itemText) text += (text ? '\n' : '') + itemText;
        } else if (itemType === 'resource') {
          const itemText = itemAny.text as string | undefined;
          const uri = itemAny.uri as string;
          if (itemText) text += (text ? '\n' : '') + itemText;
          resources.push({
            uri,
            text: itemText,
            mimeType: itemAny.mimeType as string | undefined,
          });
        } else if (itemType === 'image') {
          const imageData = itemAny.data as string | undefined;
          if (imageData) {
            images.push(imageData);
            // Collect mime types for all images if available
            if (itemAny.mimeType) {
              const mimeTypes = (metadata.imageMimeTypes as string[]) ?? [];
              mimeTypes.push(itemAny.mimeType as string);
              metadata.imageMimeTypes = mimeTypes;
            }
          }
        } else {
          metadata[itemType || 'other'] = item;
        }
      }
    }

    if (resources.length > 0) {
      metadata.resources = resources;
    }

    let finalResultText =
      text || (res.isError ? 'Tool execution failed' : 'MCP tool executed successfully');
    if (res.isError && !finalResultText.startsWith('FAILED')) {
      finalResultText = `FAILED: ${finalResultText}`;
    }

    return createToolResult(finalResultText, {
      images: images.length > 0 ? images : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }
}
