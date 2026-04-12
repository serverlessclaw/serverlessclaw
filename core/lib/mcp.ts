import { ITool, ToolType } from './types/tool';
import { MCPServerConfig } from './types/mcp';
import { logger } from './logger';
import { AgentRegistry } from './registry';
import { MCPClientManager } from './mcp/client-manager';
import { MCPToolMapper } from './mcp/tool-mapper';
import { LockManager } from './lock/lock-manager';

/**
 * MCPMultiplexer coordinates connections to external Model Context Protocol (MCP) servers.
 * It provides a unified interface for agents to discover and execute external tools
 * while maintaining a modular architecture for scalability and AI readiness.
 * Supports hub-priority routing and local command-based execution.
 */
export class MCPMultiplexer {
  private static discovering: Map<string, Promise<ITool[]>> = new Map();
  private static lastFailures: Map<string, number> = new Map();
  private static readonly FAILURE_BACKOFF_MS = 30000; // 30 seconds

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
    options?: { skipHubRouting?: boolean; isRecursive?: boolean }
  ): Promise<ITool[]> {
    const cacheKey = `mcp_tools_cache_${serverName}`;

    // 0. Check for recent failures (Discovery Backoff)
    const lastFailure = this.lastFailures.get(cacheKey);
    if (lastFailure && Date.now() - lastFailure < this.FAILURE_BACKOFF_MS) {
      logger.info(
        `[MCP] Discovery recently failed for ${serverName}, skipping until backoff expires.`
      );
      return [];
    }

    // 1. Check in-memory discovery map first (Thundering Herd Protection)
    // Only use for top-level calls to avoid self-deadlock during recursion
    if (!options?.isRecursive) {
      const existingDiscovery = this.discovering.get(cacheKey);
      if (existingDiscovery) {
        logger.info(`[MCP] Discovery already in progress for ${serverName}, awaiting...`);
        return await existingDiscovery;
      }
    }

    const discoveryPromise = (async () => {
      let acquired = false;
      let lockManager: LockManager | null = null;
      let lockId = '';
      let ownerId = '';

      // Skip locking and hub routing if this is a recursive call
      if (!options?.isRecursive) {
        // 1. Check Distributed Lock (Thundering Herd Protection across Fleet)
        lockManager = new LockManager();
        lockId = `mcp_discovery_lock_${serverName}`;
        ownerId = `node_${Math.random().toString(36).substring(7)}`;

        const hubUrl = process.env.MCP_HUB_URL;
        const isLocalCommand = !connectionString.startsWith('http');

        if (hubUrl && isLocalCommand && !options?.skipHubRouting) {
          try {
            const hubServerUrl = `${hubUrl.replace(/\/$/, '')}/${serverName}`;
            logger.info(`Attempting Hub connection for ${serverName}: ${hubServerUrl}`);
            const tools = await this.getToolsFromServer(serverName, hubServerUrl, env, {
              skipHubRouting: true,
              isRecursive: true,
            });
            if (tools.length > 0) return tools;
          } catch {
            logger.warn(`Hub connection failed for ${serverName}, switching to local.`);
          }
        }
      }

      // Check cache first before trying to acquire lock
      interface CachedTools {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: any[];
        timestamp: number;
      }
      const cacheTTL = parseInt(process.env.MCP_CACHE_TTL_MS ?? '900000');

      const checkCache = async () => {
        const cached = (await AgentRegistry.getRawConfig(cacheKey)) as CachedTools | null;
        if (cached && Date.now() - cached.timestamp < cacheTTL) {
          logger.info(`Using cached tool definitions for MCP server ${serverName}`);
          return MCPToolMapper.mapCachedTools(
            serverName,
            cached.tools,
            async () => await MCPClientManager.connect(serverName, connectionString, env)
          );
        }
        return null;
      };

      const cachedResult = await checkCache();
      if (cachedResult) return cachedResult;

      // Only acquire lock if not recursive
      if (!options?.isRecursive && lockManager) {
        // Acquire lock with retries
        // P1 Fix: Increase TTL to 300s to handle heavy cold starts (e.g. npx downloads)
        for (let i = 0; i < 3; i++) {
          acquired = await lockManager.acquire(lockId, { ttlSeconds: 300, ownerId });
          if (acquired) break;

          logger.info(`[MCP] Discovery lock for ${serverName} held by another node, waiting...`);
          await new Promise((r) => setTimeout(r, 2000));

          // Re-check cache after waiting
          const retryCached = await checkCache();
          if (retryCached) return retryCached;
        }

        if (!acquired) {
          const errorMsg = `[MCP] Failed to acquire discovery lock for ${serverName} after multiple retries. Aborting to prevent thundering herd.`;
          logger.error(errorMsg);
          throw new Error(errorMsg);
        }
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
        this.lastFailures.set(cacheKey, Date.now());
        MCPClientManager.deleteClient(serverName);
        return [];
      } finally {
        if (acquired) {
          await lockManager!.release(lockId, ownerId).catch((err: unknown) => {
            logger.warn(`Failed to release discovery lock for ${serverName}:`, err);
          });
        }
      }
    })();

    const discoveryResultPromise = discoveryPromise;

    if (!options?.isRecursive) {
      this.discovering.set(cacheKey, discoveryResultPromise);
    }

    try {
      return await discoveryResultPromise;
    } finally {
      if (!options?.isRecursive) {
        this.discovering.delete(cacheKey);
      }
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
      ast: { type: 'local', command: 'npx -y @aiready/ast-mcp-server@0.4.8' },
      filesystem: {
        type: 'local',
        command: 'npx --no-install -y @modelcontextprotocol/server-filesystem@0.6.2',
      },
      git: { type: 'local', command: 'npx --no-install -y @cyanheads/git-mcp-server@0.1.1' },
      'google-search': {
        type: 'local',
        command: 'npx --no-install -y @mcp-server/google-search-mcp@0.1.0',
      },
      puppeteer: {
        type: 'local',
        command: 'npx --no-install -y @kirkdeam/puppeteer-mcp-server@0.2.1',
      },
      fetch: { type: 'local', command: 'npx --no-install -y mcp-fetch-server@0.1.0' },
      aws: { type: 'local', command: 'npx --no-install -y mcp-aws-devops-server@0.1.0' },
      'aws-s3': { type: 'local', command: 'npx --no-install -y @geunoh/s3-mcp-server@0.1.0' },
    };

    const finalConfig = serversConfig ?? {};
    let configUpdated = false;

    // Determine base path for filesystem
    const defaultFsPath = process.env.AWS_LAMBDA_FUNCTION_NAME
      ? (process.env.MCP_FILESYSTEM_PATH ?? (process.env.LAMBDA_TASK_ROOT || '/var/task'))
      : '.';

    // Use environment variables to override default servers with Lambda multiplexer ARNs
    const serverArns: Record<string, string> = process.env.MCP_SERVER_ARNS
      ? JSON.parse(process.env.MCP_SERVER_ARNS)
      : {};

    for (const [name, defaultConfig] of Object.entries(defaultServers)) {
      if (!finalConfig[name]) {
        // If a Lambda ARN exists for this server, use it as a remote connection
        if (serverArns[name]) {
          logger.info(
            `Configuring default MCP server ${name} as remote Lambda via MCP_SERVER_ARNS`
          );
          finalConfig[name] = {
            type: 'remote',
            url: serverArns[name],
          };
        } else if (name === 'filesystem') {
          finalConfig[name] = {
            type: 'local',
            command: `npx -y @modelcontextprotocol/server-filesystem ${defaultFsPath}`,
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
      if (!requestedTools || requestedTools.length === 0) return true;
      return requestedTools.some(
        (t) => t === name || t.startsWith(`${name}_`) || t.startsWith(`${name}:`)
      );
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
        const fsPath = process.env.MCP_FILESYSTEM_PATH ?? '/tmp';
        logger.info(
          `[MCP] Forcing local execution for 'filesystem' server to preserve workspace access (Path: ${fsPath}).`
        );
        connectionString = `npx -y @modelcontextprotocol/server-filesystem ${fsPath}`;
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

    const allCached: Partial<ITool>[] = [];
    const serverNames = Object.keys(serversConfig);

    for (const name of serverNames) {
      const cacheKey = `mcp_tools_cache_${name}`;
      const cached = (await AgentRegistry.getRawConfig(cacheKey)) as {
        tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
      } | null;
      if (cached?.tools && Array.isArray(cached.tools)) {
        // Map them to include server prefix like in mapTools
        const mapped = cached.tools.map((t) => ({
          name: `${name}_${t.name}`,
          description: t.description ?? `Cached tool from ${name} server.`,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
          type: ToolType.MCP,
          connectionProfile: [],
          requiresApproval: false,
          requiredPermissions: [],
        })) as unknown as Partial<ITool>[];
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
