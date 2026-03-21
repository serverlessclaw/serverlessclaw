import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '../logger';

/**
 * Manages the lifecycle and connections of MCP clients.
 */
export class MCPClientManager {
  private static clients: Map<string, Client> = new Map();
  private static connecting: Map<string, Promise<Client>> = new Map();

  static getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }

  static deleteClient(name: string): void {
    this.clients.delete(name);
  }

  static async connect(
    serverName: string,
    connectionString: string,
    env?: Record<string, string>
  ): Promise<Client> {
    let client = this.clients.get(serverName);
    if (client) return client;

    let connectingPromise = this.connecting.get(serverName);
    if (connectingPromise) {
      return await connectingPromise;
    }

    connectingPromise = (async () => {
      let transport;
      if (connectionString.startsWith('http')) {
        transport = new SSEClientTransport(new URL(connectionString));
      } else {
        const parts = connectionString.split(' ');
        let command = parts[0];
        const args = parts.slice(1);

        // Resolve npx full path if needed (especially for Lambda)
        if (command === 'npx') {
          try {
            const { execSync } = await import('child_process');
            command = execSync('which npx', { encoding: 'utf8' }).trim();
          } catch {
            // Fallback for AWS Lambda Node.js runtimes
            const fs = await import('fs');
            const commonPaths = ['/var/lang/bin/npx', '/usr/bin/npx', '/usr/local/bin/npx'];
            for (const p of commonPaths) {
              if (fs.existsSync(p)) {
                command = p;
                break;
              }
            }
          }
        }

        transport = new StdioClientTransport({
          command,
          args,
          env: {
            ...(process.env as Record<string, string>),
            ...env,
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

      const isHub =
        connectionString.startsWith('http') &&
        connectionString.includes(process.env.MCP_HUB_URL ?? '___none___');
      // Reduce timeout for local MCP servers to prevent dashboard timeouts
      // Local servers should start quickly or fail fast
      const connectTimeout = isHub ? 5000 : 30000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`MCP Connection timeout after ${connectTimeout}ms`)),
          connectTimeout
        )
      );

      await Promise.race([newClient.connect(transport), timeoutPromise]);

      transport.onclose = () => {
        logger.warn(`MCP Server connection closed: ${serverName}`);
        this.clients.delete(serverName);
      };

      return newClient;
    })();

    this.connecting.set(serverName, connectingPromise);
    try {
      client = await connectingPromise;
      this.clients.set(serverName, client);
      return client;
    } finally {
      this.connecting.delete(serverName);
    }
  }

  static async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
