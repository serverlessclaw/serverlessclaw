import { ITool, ToolType } from './types/tool';
import { MCPServerConfig } from './types/mcp';
import { logger } from './logger';
import { AgentRegistry } from './registry';
import { MCPClientManager } from './mcp/client-manager';
import { MCPToolMapper } from './mcp/tool-mapper';

/**
 * MCPBridge coordinates connections to external Model Context Protocol (MCP) servers.
 * It provides a unified interface for agents to discover and execute external tools
 * while maintaining a modular architecture for scalability and AI readiness.
 * Supports hub-priority routing and local command-based execution.
 */
export class MCPBridge {
  /**
   * Connects to an MCP server and returns its tools.
   * Handles hub priority, remote URLs, and local fallbacks.
   *
   * @param serverName - Unique identifier for the MCP server.
   * @param connectionString - Connection URL or local shell command.
   * @param env - Optional environment variables for the connection.
   * @param options - Optional configuration flags (e.g., skipHubRouting).
   * @returns A promise that resolves to an array of discovered tools.
   */
  static async getToolsFromServer(
    serverName: string,
    connectionString: string,
    env?: Record<string, string>,
    options?: { skipHubRouting?: boolean }
  ): Promise<ITool[]> {
    const hubUrl = process.env.MCP_HUB_URL;
    const isLocalCommand = !connectionString.startsWith('http');

    if (hubUrl && isLocalCommand && !options?.skipHubRouting) {
      try {
        const hubServerUrl = `${hubUrl.replace(/\/$/, '')}/${serverName}`;
        logger.info(`Attempting Hub connection for ${serverName}: ${hubServerUrl}`);
        const tools = await this.getToolsFromServer(serverName, hubServerUrl, env, {
          skipHubRouting: true,
        });
        if (tools.length > 0) return tools;
      } catch {
        logger.warn(`Hub connection failed for ${serverName}, switching to local.`);
      }
    }

    // Check cache first
    const cacheKey = `mcp_tools_cache_${serverName}`;
    interface CachedTools {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: any[];
      timestamp: number;
    }
    const cached = (await AgentRegistry.getRawConfig(cacheKey)) as CachedTools | null;

    const cacheTTL = parseInt(process.env.MCP_CACHE_TTL_MS ?? '900000');
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      logger.info(`Using cached tool definitions for MCP server ${serverName}`);
      return MCPToolMapper.mapCachedTools(
        serverName,
        cached.tools,
        async () => await MCPClientManager.connect(serverName, connectionString, env)
      );
    }

    try {
      const client = await MCPClientManager.connect(serverName, connectionString, env);
      const response = await client.listTools();

      // Update cache
      await AgentRegistry.saveRawConfig(cacheKey, {
        tools: response.tools,
        timestamp: Date.now(),
      });

      return MCPToolMapper.mapTools(serverName, client, response.tools);
    } catch (e: unknown) {
      logger.warn(`Failed to fetch tools from ${serverName}:`, e);
      MCPClientManager.deleteClient(serverName);
      return [];
    }
  }

  /**
   * Discovers and loads tools from configured MCP servers.
   * @param requestedTools - Optional list of specific tools to load
   * @param skipConnection - If true, returns tool definitions without connecting to servers (for dashboard display)
   */
  static async getExternalTools(
    requestedTools?: string[],
    skipConnection: boolean = false
  ): Promise<ITool[]> {
    const serversConfig = (await AgentRegistry.getRawConfig('mcp_servers')) as Record<
      string,
      string | MCPServerConfig
    >;

    const allTools: ITool[] = [];
    const defaultServers: Record<string, MCPServerConfig> = {
      ast: { type: 'local', command: 'npx -y @aiready/ast-mcp-server@0.1.6' },
      filesystem: { type: 'local', command: 'npx -y @modelcontextprotocol/server-filesystem .' },
      git: { type: 'local', command: 'npx -y @cyanheads/git-mcp-server' },
      'google-search': { type: 'local', command: 'npx -y @mcp-server/google-search-mcp' },
      puppeteer: { type: 'local', command: 'npx -y @kirkdeam/puppeteer-mcp-server' },
      fetch: { type: 'local', command: 'npx -y mcp-fetch-server' },
      aws: { type: 'local', command: 'npx -y mcp-aws-devops-server' },
      'aws-s3': { type: 'local', command: 'npx -y @geunoh/s3-mcp-server' },
    };

    const finalConfig = serversConfig ?? {};
    let configUpdated = false;

    // Use environment variables to override default servers with Lambda multiplexer ARNs
    const serverArns: Record<string, string> = process.env.MCP_SERVER_ARNS
      ? JSON.parse(process.env.MCP_SERVER_ARNS)
      : {};

    for (const [name, defaultConfig] of Object.entries(defaultServers)) {
      if (!finalConfig[name]) {
        // If a Lambda ARN exists for this server, use it as a remote connection
        if (serverArns[name]) {
          logger.info(`Configuring default MCP server ${name} as remote Lambda via MCP_SERVER_ARNS`);
          finalConfig[name] = {
            type: 'remote',
            url: serverArns[name],
          };
        } else {
          finalConfig[name] = defaultConfig;
        }
        configUpdated = true;
      }
    }

    if (configUpdated) {
      await AgentRegistry.saveRawConfig('mcp_servers', finalConfig);
    }

    // Filter configuration to only servers we actually need before creating any promises
    const neededConfigs = Object.entries(finalConfig).filter(([name]) => {
      return !requestedTools || requestedTools.some((t) => t === name || t.startsWith(`${name}_`));
    });

    const serverPromises = neededConfigs.map(async ([name, config]) => {
      if (typeof config === 'object' && config.type === 'managed') {
        return [
          {
            name: config.name ?? name,
            description: config.description ?? `Managed tool for ${name}`,
            parameters: config.parameters ?? { type: 'object' as const, properties: {} },
            connector_id: config.connector_id,
            type: ToolType.MCP,
            connectionProfile: [],
            requiresApproval: false,
            requiredPermissions: [],
            execute: async () => `Managed tool (${name}) executed autonomously by provider.`,
          },
        ];
      }

      // When skipConnection is true, return placeholder definitions without connecting
      if (skipConnection) {
        return [
          {
            name: `${name}`,
            description: `MCP server: ${name} (Connect to see tools)`,
            parameters: { type: 'object' as const, properties: {} },
            type: ToolType.MCP,
            connectionProfile: [],
            requiresApproval: false,
            requiredPermissions: [],
            execute: async () => `MCP server ${name} placeholder`,
          },
        ];
      }

      let connectionString: string;
      let env: Record<string, string> | undefined;

      if (typeof config === 'string') {
        connectionString = config;
      } else if (config.type === 'remote') {
        connectionString = config.url;
      } else if (config.type === 'local') {
        connectionString = config.command;
        env = config.env;
      } else {
        // Managed or other types not supported for direct command execution
        return [];
      }

      // Special handling for filesystem: Always attempt local execution if we're in a Lambda with a workspace
      if (name === 'filesystem' && !!process.env.AWS_LAMBDA_FUNCTION_NAME) {
        logger.info(
          `[MCP] Forcing local execution for 'filesystem' server to preserve workspace access.`
        );
        connectionString = 'npx -y @modelcontextprotocol/server-filesystem /tmp';
      }

      try {
        return await this.getToolsFromServer(name, connectionString, env);
      } catch (e) {
        logger.error(`Discovery failed for MCP server ${name}:`, e);
        return [];
      }
    });

    const results = await Promise.all(serverPromises);
    for (const serverTools of results) {
      allTools.push(...serverTools);
    }

    return allTools;
  }

  /**
   * Retrieves tool definitions from all cached MCP server results.
   */
  static async getCachedTools(): Promise<Partial<ITool>[]> {
    const serversConfig = (await AgentRegistry.getRawConfig('mcp_servers')) as Record<
      string,
      string | MCPServerConfig
    >;

    if (!serversConfig) return [];

    const allCached: any[] = [];
    const serverNames = Object.keys(serversConfig);

    for (const name of serverNames) {
      const cacheKey = `mcp_tools_cache_${name}`;
      const cached = (await AgentRegistry.getRawConfig(cacheKey)) as { tools: any[] } | null;
      if (cached?.tools && Array.isArray(cached.tools)) {
        // Map them to include server prefix like in mapTools
        const mapped = cached.tools.map((t: any) => ({
          name: `${name}_${t.name}`,
          description: t.description ?? `Cached tool from ${name} server.`,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
          type: ToolType.MCP,
          connectionProfile: [],
          requiresApproval: false,
          requiredPermissions: [],
        }));
        allCached.push(...mapped);
      }
    }

    return allCached;
  }

  /**
   * Closes all active MCP connections.
   */
  static async closeAll(): Promise<void> {
    await MCPClientManager.closeAll();
  }
}
