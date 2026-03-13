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
    env?: Record<string, string>
  ): Promise<ITool[]> {
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
            env: { ...(process.env as Record<string, string>), ...env },
          });
        }

        client = new Client(
          { name: 'ServerlessClaw-Client', version: '1.0.0' },
          { capabilities: {} }
        );
        await client.connect(transport);
        this.clients.set(serverName, client);
      }

      const response = await client.listTools();
      return response.tools.map((mcpTool) => ({
        name: `${serverName}_${mcpTool.name}`,
        description: mcpTool.description || `Tool from ${serverName} server.`,
        parameters: mcpTool.inputSchema as JsonSchema,
        execute: async (toolArgs: Record<string, unknown>) => {
          const result = await client!.callTool({
            name: mcpTool.name,
            arguments: toolArgs,
          });
          return JSON.stringify(result.content);
        },
      }));
    } catch (e) {
      logger.error(`Failed to fetch tools from MCP server ${serverName}:`, e);
      return [];
    }
  }

  /**
   * Discovers and loads all tools from all configured MCP servers.
   */
  static async getAllExternalTools(): Promise<ITool[]> {
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
        command: 'npx -y @modelcontextprotocol/server-git',
        env: {},
      },
      'google-search': {
        command: 'npx -y @modelcontextprotocol/server-google-search',
        env: {},
      },
      puppeteer: {
        command: 'npx -y @modelcontextprotocol/server-puppeteer',
        env: {},
      },
      fetch: {
        command: 'npx -y @modelcontextprotocol/server-fetch',
        env: {},
      },
      aws: {
        command: 'npx -y @modelcontextprotocol/server-aws',
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
