import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ITool, JsonSchema } from './types/tool';
import { logger } from './logger';
import { AgentRegistry } from './registry';

/**
 * MCPBridge allows ServerlessClaw to connect to external Model Context Protocol servers.
 * It dynamically discovers tools from these servers and makes them available to agents.
 */
export class MCPBridge {
  private static clients: Map<string, Client> = new Map();

  /**
   * Connects to an MCP server (Local or Remote) and returns its tools.
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
        let transport;

        if (connectionString.startsWith('http')) {
          logger.info(`Connecting to Remote MCP Server: ${serverName} (${connectionString})`);
          transport = new SSEClientTransport(new URL(connectionString));
        } else {
          const parts = connectionString.split(' ');
          const command = parts[0];
          const args = parts.slice(1);
          logger.info(`Spawning Local MCP Server: ${serverName} (${command} ${args.join(' ')})`);
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

          // Hack to capture stderr from the internal child process if possible
          // Note: The SDK doesn't natively expose the process, but we can wrap it if needed.
          // For now, we'll rely on the client.connect error which usually captures spawn failures.
        }

        client = new Client(
          { name: 'ServerlessClaw-Client', version: '1.0.0' },
          { capabilities: {} }
        );

        // Add a timeout to connection to prevent hanging Lambdas
        const isHub =
          connectionString.startsWith('http') &&
          connectionString.includes(process.env.MCP_HUB_URL || '___none___');
        const connectTimeout = isHub ? 5000 : 30000; // 5s for Hub, 30s for Local/Direct
        const timeoutPromise = new Promise((_, reject) =>
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

        await Promise.race([client.connect(transport), timeoutPromise]);
        this.clients.set(serverName, client);

        // Listen for close event if the SDK supports it or handle it in the execute wrap
        transport.onclose = () => {
          logger.warn(`MCP Server connection closed: ${serverName}. Removing from cache.`);
          this.clients.delete(serverName);
        };

        transport.onerror = (err: any) => {
          logger.error(`MCP Transport Error (${serverName}):`, err);
          this.clients.delete(serverName);
        };
      }

      const response = await client.listTools();
      return response.tools.map((mcpTool) => ({
        name: `${serverName}_${mcpTool.name}`,
        description: mcpTool.description || `Tool from ${serverName} server.`,
        parameters: mcpTool.inputSchema as JsonSchema,
        execute: async (toolArgs: Record<string, unknown>) => {
          try {
            if (!client) throw new Error('MCP Client not initialized');
            const result = await client.callTool({
              name: mcpTool.name,
              arguments: toolArgs,
            });
            return JSON.stringify(result.content);
          } catch (execError: any) {
            const errorDetails = {
              message: execError?.message,
              code: execError?.code,
              stack: execError?.stack,
              nodeVersion: process.version,
              memoryUsage: process.memoryUsage(),
              server: serverName,
              tool: mcpTool.name,
            };
            logger.error(`MCP Tool Execution Error Details:`, JSON.stringify(errorDetails));

            if (execError?.message?.includes('Connection closed')) {
              this.clients.delete(serverName); // Force re-connect on next call
            }
            throw execError;
          }
        },
      }));
    } catch (e: any) {
      logger.error(`Failed to fetch tools from MCP server ${serverName}:`, e);
      this.clients.delete(serverName); // Clean up failed attempts
      return [];
    }
  }

  /**
   * Discovers and loads tools from configured MCP servers, optionally filtered by requested tool names.
   */
  static async getExternalTools(requestedTools?: string[]): Promise<ITool[]> {
    let serversConfig = (await AgentRegistry.getRawConfig('mcp_servers')) as Record<
      string,
      string | { command: string; env?: Record<string, string> }
    >;

    const allTools: ITool[] = [];
    let configUpdated = false;

    // 2026: Ensure default servers exist individually
    const defaultServers: Record<string, { command: string; env: Record<string, string> }> = {
      filesystem: {
        command: 'npx -y @modelcontextprotocol/server-filesystem .',
        env: {},
      },
      git: {
        command: 'npx -y @cyanheads/git-mcp-server',
        env: {},
      },
      'google-search': {
        command: 'npx -y @mcp-server/google-search-mcp',
        env: {},
      },
      puppeteer: {
        command: 'npx -y @kirkdeam/puppeteer-mcp-server',
        env: {},
      },
      fetch: {
        command: 'npx -y mcp-fetch-server',
        env: {},
      },
      aws: {
        command: 'npx -y mcp-aws-devops-server',
        env: {},
      },
      'aws-s3': {
        command: 'npx -y @geunoh/s3-mcp-server',
        env: {},
      },
    };

    if (!serversConfig) serversConfig = {};

    for (const [name, defaultConfig] of Object.entries(defaultServers)) {
      if (!serversConfig[name]) {
        logger.info(`Bootstrapping missing default bridge: ${name}`);
        serversConfig[name] = defaultConfig;
        configUpdated = true;
      }
    }

    if (configUpdated) {
      await AgentRegistry.saveRawConfig('mcp_servers', serversConfig);
    }

    for (const [name, config] of Object.entries(serversConfig)) {
      // Lazy loading: only connect if we don't have requestedTools OR if one of them starts with the server name prefix
      const needsThisServer =
        !requestedTools || requestedTools.some((t) => t.startsWith(`${name}_`));

      if (!needsThisServer) {
        logger.debug(`Skipping MCP server ${name} (not requested by agent)`);
        continue;
      }

      const connectionString = typeof config === 'string' ? config : config.command;
      const env = typeof config === 'string' ? undefined : config.env;

      const serverTools = await this.getToolsFromServer(name, connectionString, env);
      allTools.push(...serverTools);
    }

    return allTools;
  }

  /**
   * Cleanup connections.
   */
  static async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
