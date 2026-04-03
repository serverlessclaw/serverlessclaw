import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
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

  private static failureCounts: Map<string, { count: number; lastFailure: number }> = new Map();
  private static readonly FAILURE_RESET_MS = 60000; // 1 minute
  private static readonly MAX_FAILURES = 3;

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

    // 1. Check in-memory connecting map IMMEDIATELY (no await before this)
    let connectingPromise = this.connecting.get(serverName);
    if (connectingPromise) {
      return await connectingPromise;
    }

    // 2. Prepare the connection promise
    connectingPromise = (async () => {
      // Check circuit breaker (Gap 3/4)
      const failure = this.failureCounts.get(serverName);
      if (failure && failure.count >= this.MAX_FAILURES) {
        const backoffFactor = Math.pow(2, Math.min(failure.count - this.MAX_FAILURES, 4));
        const retryDelay = this.FAILURE_RESET_MS * backoffFactor;
        const timeSinceFailure = Date.now() - failure.lastFailure;

        if (timeSinceFailure < retryDelay) {
          logger.warn(
            `Circuit breaker OPEN for ${serverName}. Retrying in ${Math.round((retryDelay - timeSinceFailure) / 1000)}s`
          );
          throw new Error(
            `Circuit breaker open for ${serverName} after ${failure.count} failures. Retrying in ${Math.round((retryDelay - timeSinceFailure) / 1000)}s`
          );
        } else {
          // Reset after timeout or at least allow one probe
          logger.info(`Circuit breaker HALF-OPEN for ${serverName}, attempting probe connection.`);
        }
      }

      // Check persistent health (Gap 5/Step 6)
      const { AgentRegistry } = await import('../registry');
      const persistentHealth = (await AgentRegistry.getRawConfig(`mcp_health_${serverName}`)) as {
        status: string;
        timestamp: number;
      } | null;
      if (
        persistentHealth?.status === 'down' &&
        Date.now() - persistentHealth.timestamp < this.FAILURE_RESET_MS
      ) {
        logger.warn(`Server ${serverName} is marked as DOWN in DynamoDB. skipping.`);
        throw new Error(`Server ${serverName} is currently down.`);
      }

      logger.info(`Starting new connection for ${serverName}`);
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
      const connectTimeout = isHub ? 5000 : 30000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`MCP Connection timeout after ${connectTimeout}ms`)),
          connectTimeout
        );
      });

      try {
        await Promise.race([newClient.connect(transport), timeoutPromise]);
        clearTimeout(timeoutId!);
        // Success - clear failures and update persistent health
        this.failureCounts.delete(serverName);
        await AgentRegistry.saveRawConfig(`mcp_health_${serverName}`, {
          status: 'up',
          timestamp: Date.now(),
        });
      } catch (error) {
        // Increment failure count and mark as down in DynamoDB
        const prev = this.failureCounts.get(serverName) ?? { count: 0, lastFailure: 0 };
        const newCount = prev.count + 1;
        this.failureCounts.set(serverName, {
          count: newCount,
          lastFailure: Date.now(),
        });

        if (newCount >= this.MAX_FAILURES) {
          await AgentRegistry.saveRawConfig(`mcp_health_${serverName}`, {
            status: 'down',
            timestamp: Date.now(),
          });
        }

        // 1.5 Ensure transport and client are closed on timeout or failure
        logger.error(`Failed to connect to MCP server ${serverName}:`, error);
        try {
          await transport.close();
        } catch (closeError) {
          logger.warn(`Error closing transport after failed connection:`, closeError);
        }
        try {
          await newClient.close();
        } catch (closeError) {
          logger.warn(`Error closing client after failed connection:`, closeError);
        }
        throw error;
      }

      transport.onclose = () => {
        logger.warn(`MCP Server connection closed: ${serverName}`);
        this.clients.delete(serverName);
      };

      return newClient;
    })();

    // 3. Register the promise IMMEDIATELY after creation
    this.connecting.set(serverName, connectingPromise);

    try {
      client = await connectingPromise;
      if (client) {
        this.clients.set(serverName, client);
      }
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
    this.connecting.clear();
  }
}

/**
 * Lambda Invoke Transport for MCP servers running as Lambda functions.
 */
class LambdaInvokeTransport {
  constructor(
    private readonly functionArn: string,
    private readonly serverName: string
  ) {}

  async start(): Promise<void> {
    // No-op for Lambda transport
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      const messageString = JSON.stringify(message);
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
            body: messageString,
          }),
        })
      );

      if (result.FunctionError) {
        throw new Error(`Lambda function error: ${result.FunctionError}`);
      }

      if (result.Payload) {
        const payload = JSON.parse(Buffer.from(result.Payload).toString());
        if (payload.statusCode !== 200) {
          throw new Error(`MCP server returned error: ${payload.body}`);
        }
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
  onmessage?: (message: JSONRPCMessage) => void;
}
