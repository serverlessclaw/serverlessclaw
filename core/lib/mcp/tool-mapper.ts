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
    const isSequential =
      ['filesystem', 'git'].includes(serverName) ||
      mcpTool.name.startsWith('filesystem_') ||
      mcpTool.name.startsWith('git_');

    const toolName = `${serverName}_${mcpTool.name}`;
    const parameters = (mcpTool.inputSchema as JsonSchema) || { type: 'object', properties: {} };
    const pathKeys = PathKeyDiscoverer.discover(parameters);

    return {
      name: toolName,
      description: mcpTool.description ?? `Tool from ${serverName} server.`,
      parameters,
      argSchema: jsonSchemaToZod(parameters),
      type: ToolType.MCP,
      connectionProfile: [],
      connector_id: '',
      auth: { type: 'api_key', resource_id: '' },
      requiresApproval: mcpTool.requiresApproval ?? false,
      requiredPermissions: mcpTool.requiredPermissions ?? [],
      sequential: isSequential,
      pathKeys: pathKeys.length > 0 ? pathKeys : undefined,
      execute: async (toolArgs: Record<string, unknown>) => {
        return this.executeMcpTool(serverName, mcpTool.name, toolName, toolArgs, clientProvider);
      },
    };
  }

  private static async executeMcpTool(
    serverName: string,
    rawToolName: string,
    prefixedName: string,
    args: Record<string, unknown>,
    clientProvider: () => Promise<Client>
  ): Promise<ToolResult> {
    try {
      const client = await clientProvider();
      const { withMCPResilience, isConnectionError } = await import('../lifecycle/error-recovery');

      return await withMCPResilience(
        prefixedName,
        async () => {
          const result = await client.callTool({ name: rawToolName, arguments: args });
          return this.parseMcpToolResult(result);
        },
        {
          onFailure: (error: Error) => {
            if (isConnectionError(error)) {
              logger.info(`[MCP] Resetting client for ${serverName} due to disconnection.`);
              MCPClientManager.deleteClient(serverName);
            }
          },
        }
      );
    } catch (e: unknown) {
      logger.error(
        `MCP Tool Execution Error (${serverName}:${rawToolName}):`,
        e instanceof Error ? e.message : String(e)
      );
      throw e;
    }
  }

  /**
   * Parses MCP callTool result into a structured ToolResult.
   */
  private static parseMcpToolResult(result: unknown): ToolResult {
    const res = result as { content?: any[]; isError?: boolean };
    const images: string[] = [];
    const resources: any[] = [];
    let text = '';
    const metadata: Record<string, any> = {};

    if (Array.isArray(res.content)) {
      for (const item of res.content) {
        if (item.type === 'text' || !item.type) {
          text += (text ? '\n' : '') + (item.text || '');
        } else if (item.type === 'resource') {
          text += (text ? '\n' : '') + (item.text || '');
          resources.push({ uri: item.uri, text: item.text, mimeType: item.mimeType });
        } else if (item.type === 'image') {
          if (item.data) images.push(item.data);
          if (item.mimeType) {
            metadata.imageMimeTypes = [...(metadata.imageMimeTypes || []), item.mimeType];
          }
        } else {
          metadata[item.type] = item;
        }
      }
    }

    if (resources.length > 0) metadata.resources = resources;

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

class PathKeyDiscoverer {
  private static readonly PATH_KEYWORDS = [
    'path',
    'file',
    'directory',
    'dir',
    'folder',
    'src',
    'dest',
    'source',
    'destination',
  ];

  static discover(params: JsonSchema): string[] {
    const pathKeys: string[] = [];
    if (params.type !== 'object' || !params.properties) return pathKeys;

    for (const [key, prop] of Object.entries(params.properties)) {
      const desc = (prop.description ?? '').toLowerCase();
      const lowKey = key.toLowerCase();
      const propType = prop.type as string;

      const isPathLike = (type: string, description: string, keyName: string) => {
        const matchesKeyword = this.PATH_KEYWORDS.some(
          (kw) => description.includes(kw) || keyName.includes(kw)
        );
        if (type === 'string') return matchesKeyword;
        if (type === 'array' && prop.items && (prop.items as any).type === 'string') {
          return matchesKeyword || keyName.endsWith('s');
        }
        return false;
      };

      if (isPathLike(propType, desc, lowKey)) {
        pathKeys.push(key);
      }
    }
    return pathKeys;
  }
}
