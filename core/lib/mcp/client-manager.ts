import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from '../logger';

const lambdaClient = new LambdaClient({});

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

  /**
   * Connect to an MCP server.
   * Supports multiple transport types:
   * - HTTP/HTTPS: Uses SSE transport (for remote servers)
   * - Lambda ARN: Uses Lambda Invoke transport (for Lambda-based MCP servers)
   * - Command: Uses stdio transport (for local development)
   */
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

      // Check if this is a Lambda ARN
      if (connectionString.startsWith('arn:aws:lambda:')) {
        logger.info(`Connecting to MCP server ${serverName} via Lambda Invoke`);
        transport = new LambdaInvokeTransport(connectionString, serverName);
      } else if (connectionString.startsWith('http')) {
        // HTTP/HTTPS - use SSE transport
        transport = new SSEClientTransport(new URL(connectionString));
      } else {
        // Local command - use stdio transport
        const parts = connectionString.split(' ');
        let command = parts[0];
        const args = parts.slice(1);

        // Resolve npx full path if needed (especially for Lambda)
        if (command === 'npx') {
          const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
          if (isLambda) {
            logger.warn(
              `Cannot spawn local MCP server '${serverName}' using npx in Lambda. Use MCP_HUB_URL for external tools.`
            );
            throw new Error(
              `Cannot spawn local MCP server '${serverName}' using npx in Lambda environment. Please use MCP_HUB_URL for external tools.`
            );
          }

          try {
            const { execSync } = await import('child_process');
            command = execSync('which npx', { encoding: 'utf8' }).trim();
          } catch {
            // Fallback for environments where 'which' fails or npx is in common paths
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

/**
 * Lambda Invoke Transport for MCP servers running as Lambda functions.
 * Uses the AWS SDK to invoke Lambda functions directly.
 */
class LambdaInvokeTransport {
  constructor(
    private readonly functionArn: string,
    private readonly serverName: string
  ) {}

  async start(): Promise<void> {
    // No-op for Lambda transport
  }

  async send(message: string): Promise<void> {
    try {
      const result = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: this.functionArn,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            httpMethod: 'POST',
            path: '/mcp',
            headers: {
              'Content-Type': 'application/json',
            },
            body: message,
          }),
        })
      );

      if (result.FunctionError) {
        throw new Error(`Lambda function error: ${result.FunctionError}`);
      }

      // Process the response and pass to onmessage callback
      if (result.Payload) {
        const payload = JSON.parse(Buffer.from(result.Payload).toString());
        if (payload.statusCode !== 200) {
          throw new Error(`MCP server returned error: ${payload.body}`);
        }
        // The response body contains the MCP response (JSON-RPC message)
        if (this.onmessage) {
          this.onmessage(payload.body);
        }
      }
    } catch (error) {
      logger.error(`Failed to invoke MCP server ${this.serverName}`, {
        functionArn: this.functionArn,
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.onerror) {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.onclose) {
      this.onclose();
    }
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: string) => void;
}
