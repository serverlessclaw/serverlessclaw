import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ITool, JsonSchema, MCPServerConfig } from './types/index';
import { logger } from './logger';
import { AgentRegistry } from './registry';
import { checkFileSecurity } from './utils/fs-security';

/**
 * MCPBridge allows ServerlessClaw to connect to external Model Context Protocol servers.
 * It dynamically discovers tools from these servers and makes them available to agents.
 *
 * Updated: March 2026 - Added human-in-the-loop security checks for filesystem tools.
 */
export class MCPBridge {
  private static clients: Map<string, Client> = new Map();
  private static connecting: Map<string, Promise<Client>> = new Map();

  /**
   * Connects to an MCP server (Local or Remote) and returns its tools.
   *
   * @param serverName - The unique identifier for the MCP server.
   * @param connectionString - The command to spawn or URL to connect to.
   * @param env - Optional environment variables for the server process.
   * @param forceLocal - Whether to force a local connection even if a hub is available.
   * @returns A promise resolving to an array of discovered ITool objects.
   */
  static async getToolsFromServer(
    serverName: string,
    connectionString: string,
    env?: Record<string, string>,
    forceLocal: boolean = false
  ): Promise<ITool[]> {
    const hubUrl = process.env.MCP_HUB_URL;
    const isLocalCommand = !connectionString.startsWith('http');

    // External Hub Priority Logic:
    // If we have a Hub URL and it's a local command (not already a direct URL),
    // and we aren't being forced to stay local (e.g. after a hub failure).
    if (hubUrl && isLocalCommand && !forceLocal) {
      try {
        const hubServerUrl = `${hubUrl.replace(/\/$/, '')}/${serverName}`;
        logger.info(`Attempting to connect to MCP Hub for ${serverName}: ${hubServerUrl}`);

        // Use a much shorter timeout for the Hub handshake
        const tools = await this.getToolsFromServer(serverName, hubServerUrl, env, false);
        if (tools.length > 0) {
          return tools;
        }
      } catch (hubError) {
        logger.warn(
          `MCP Hub connection failed for ${serverName}, falling back to local:`,
          hubError
        );
        // Continue to local execution
      }
    }

    try {
      let client = this.clients.get(serverName);

      if (!client) {
        // If already connecting, wait for it
        let connectingPromise = this.connecting.get(serverName);
        if (connectingPromise) {
          logger.debug(`Waiting for existing connection to MCP server: ${serverName}`);
          client = await connectingPromise;
        } else {
          // Start a new connection
          connectingPromise = (async () => {
            let transport;

            if (connectionString.startsWith('http')) {
              logger.info(`Connecting to Remote MCP Server: ${serverName} (${connectionString})`);
              transport = new SSEClientTransport(new URL(connectionString));
            } else {
              const parts = connectionString.split(' ');
              const command = parts[0];
              const args = parts.slice(1);
              logger.info(
                `Spawning Local MCP Server: ${serverName} (${command} ${args.join(' ')})`
              );
              transport = new StdioClientTransport({
                command,
                args,
                env: {
                  ...(process.env as Record<string, string>),
                  ...env,
                  // Critical for AWS Lambda: ensures npx/npm has a writable directory to cache packages
                  XDG_CACHE_HOME: '/tmp/mcp-cache',
                  NPM_CONFIG_CACHE: '/tmp/npm-cache',
                  HOME: '/tmp',
                },
              });
            }

            const newClient = new Client(
              { name: 'ServerlessClaw-Client', version: '1.0.0' },
              { capabilities: {} }
            );

            // Add a timeout to connection to prevent hanging Lambdas
            const isHub =
              connectionString.startsWith('http') &&
              connectionString.includes(process.env.MCP_HUB_URL || '___none___');
            const connectTimeout = isHub ? 5000 : 60000; // 5s for Hub, 60s for Local/Direct
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `MCP Connection timeout (${isHub ? 'Hub' : 'Direct'}) after ${connectTimeout}ms`
                    )
                  ),
                connectTimeout
              )
            );

            await Promise.race([newClient.connect(transport), timeoutPromise]);

            // Listen for close event if the SDK supports it or handle it in the execute wrap
            transport.onclose = () => {
              logger.warn(`MCP Server connection closed: ${serverName}. Removing from cache.`);
              this.clients.delete(serverName);
            };

            transport.onerror = (err: unknown) => {
              logger.error(`MCP Transport Error (${serverName}):`, err);
              this.clients.delete(serverName);
            };

            return newClient;
          })();

          this.connecting.set(serverName, connectingPromise);

          try {
            client = await connectingPromise;
            this.clients.set(serverName, client);
          } finally {
            this.connecting.delete(serverName);
          }
        }
      }

      const response = await client!.listTools();
      return response.tools.map((mcpTool) => {
        const isFilesystemTool =
          serverName === 'filesystem' || mcpTool.name.startsWith('filesystem_');
        const toolName = `${serverName}_${mcpTool.name}`;

        // 2026: Inject manuallyApproved parameter into filesystem tool schemas for human-in-the-loop self-evolution
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
          description: mcpTool.description || `Tool from ${serverName} server.`,
          parameters,
          execute: async (toolArgs: Record<string, unknown>) => {
            // Enforcement Layer for MCP Filesystem tools
            if (isFilesystemTool) {
              const filePath =
                (toolArgs.path as string) ||
                (toolArgs.path_to_file as string) ||
                (toolArgs.file_path as string) ||
                (toolArgs.path as string);
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
              if (!client) throw new Error('MCP Client not initialized');
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: toolArgs,
              });
              return JSON.stringify(result.content);
            } catch (execError: unknown) {
              const error = execError as Error & { code?: string };
              const errorDetails = {
                message: error?.message,
                code: error?.code,
                stack: error?.stack,
                nodeVersion: process.version,
                memoryUsage: process.memoryUsage(),
                server: serverName,
                tool: mcpTool.name,
              };
              logger.error(`MCP Tool Execution Error Details:`, JSON.stringify(errorDetails));

              if (error?.message?.includes('Connection closed')) {
                this.clients.delete(serverName); // Force re-connect on next call
              }
              throw execError;
            }
          },
        };
      });
    } catch (e: unknown) {
      logger.error(`Failed to fetch tools from MCP server ${serverName}:`, e);
      this.clients.delete(serverName); // Clean up failed attempts
      return [];
    }
  }

  /**
   * Discovers and loads tools from configured MCP servers, optionally filtered by requested tool names.
   *
   * @param requestedTools - Optional list of tool names the agent wants to use.
   * @returns A promise resolving to an array of consolidated ITool objects.
   */
  static async getExternalTools(requestedTools?: string[]): Promise<ITool[]> {
    const serversConfig = (await AgentRegistry.getRawConfig('mcp_servers')) as Record<
      string,
      string | MCPServerConfig
    >;

    const allTools: ITool[] = [];
    let configUpdated = false;

    // 2026: Ensure default servers exist individually
    const defaultServers: Record<string, MCPServerConfig> = {
      filesystem: {
        command: 'npx -y @modelcontextprotocol/server-filesystem .',
      },
      git: {
        command: 'npx -y @cyanheads/git-mcp-server',
      },
      'google-search': {
        command: 'npx -y @mcp-server/google-search-mcp',
      },
      puppeteer: {
        command: 'npx -y @kirkdeam/puppeteer-mcp-server',
      },
      fetch: {
        command: 'npx -y mcp-fetch-server',
      },
      aws: {
        command: 'npx -y mcp-aws-devops-server',
      },
      'aws-s3': {
        command: 'npx -y @geunoh/s3-mcp-server',
      },
    };

    const finalConfig = serversConfig || {};

    for (const [name, defaultConfig] of Object.entries(defaultServers)) {
      if (!finalConfig[name]) {
        logger.info(`Bootstrapping missing default bridge: ${name}`);
        finalConfig[name] = defaultConfig;
        configUpdated = true;
      }
    }

    if (configUpdated) {
      await AgentRegistry.saveRawConfig('mcp_servers', finalConfig);
    }

    for (const [name, config] of Object.entries(finalConfig)) {
      // Lazy loading: only connect if we don't have requestedTools OR if one of them starts with the server name prefix
      const needsThisServer =
        !requestedTools || requestedTools.some((t) => t === name || t.startsWith(`${name}_`));

      if (!needsThisServer) {
        logger.debug(`Skipping MCP server ${name} (not requested by agent)`);
        continue;
      }

      // 2026: Support for Managed Connectors (OpenAI-maintained)
      if (typeof config === 'object' && config.type === 'managed') {
        logger.info(`Adding Managed Connector: ${name} (${config.connector_id})`);
        allTools.push({
          name: config.name || name,
          description: config.description || `Managed tool for ${name}`,
          parameters: config.parameters || { type: 'object', properties: {} },
          connector_id: config.connector_id,
          type: 'mcp',
          execute: async () => {
            return `This tool (${name}) is managed by the model provider and executed autonomously.`;
          },
        });
        continue;
      }

      const connectionString = typeof config === 'string' ? config : config.command;
      const env = typeof config === 'string' ? undefined : config.env;

      const serverTools = await this.getToolsFromServer(name, connectionString, env);
      allTools.push(...serverTools);
    }

    // Cache tools list for dashboard performance (if this was a full discovery)
    if (!requestedTools) {
      const cacheableTools = allTools.map((t) => ({
        name: t.name,
        description: t.description,
        isExternal: true,
      }));
      await AgentRegistry.saveRawConfig('mcp_tools_cache', cacheableTools);
    }

    return allTools;
  }

  /**
   * Retrieves tool definitions from cache without connecting to MCP servers.
   *
   * @returns A promise resolving to an array of partially defined cached tool objects.
   */
  static async getCachedTools(): Promise<Partial<ITool>[]> {
    const cached = await AgentRegistry.getRawConfig('mcp_tools_cache');
    return Array.isArray(cached) ? cached : [];
  }

  /**
   * Cleanup connections.
   *
   * @returns A promise resolving when all connections are closed.
   */
  static async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
