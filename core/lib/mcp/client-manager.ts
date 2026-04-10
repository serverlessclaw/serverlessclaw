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
    // Check for exact match or cwd-prefixed match
    const client = this.clients.get(name);
    if (client) return client;

    // Fallback: check if there's any client for this name (though usually connect() is used)
    for (const [key, val] of this.clients.entries()) {
      if (key.startsWith(`${name}:`)) return val;
    }
    return undefined;
  }

  static deleteClient(name: string): void {
    // Delete all clients starting with this name (handles name:cwd keys)
    for (const key of Array.from(this.clients.keys())) {
      if (key === name || key.startsWith(`${name}:`)) {
        const client = this.clients.get(key);
        client?.close().catch(() => {});
        this.clients.delete(key);
      }
    }
    for (const key of Array.from(this.connecting.keys())) {
      if (key === name || key.startsWith(`${name}:`)) {
        this.connecting.delete(key);
      }
    }
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
    const isLocal =
      !connectionString.startsWith('http') && !connectionString.startsWith('arn:aws:lambda:');
    const cwd = process.cwd();
    const cacheKey = isLocal ? `${serverName}:${cwd}` : serverName;

    let client = this.clients.get(cacheKey);
    if (client) return client;

    // 1. Check in-memory connecting map IMMEDIATELY (no await before this)
    let connectingPromise = this.connecting.get(cacheKey);
    if (connectingPromise) {
      return await connectingPromise;
    }

    // 2. Prepare the connection promise
    connectingPromise = (async () => {
      const { AgentRegistry } = await import('../registry');

      // Check persistent health and global failure counts (B1: Global Circuit Breaker)
      const persistentHealth = (await AgentRegistry.getRawConfig(`mcp_health_${serverName}`)) as {
        status: string;
        count?: number;
        lastFailure?: number;
        timestamp: number;
      } | null;

      // Sync local failure count with global state
      // B1 Fix: Add timestamp check to prevent stale counts from incorrectly tripping circuit
      if (persistentHealth?.count !== undefined) {
        const localFailure = this.failureCounts.get(serverName);
        const lastFailureTime = persistentHealth.lastFailure ?? persistentHealth.timestamp;
        const globalIsFresh = Date.now() - lastFailureTime < this.FAILURE_RESET_MS;
        if (globalIsFresh && (!localFailure || persistentHealth.count > localFailure.count)) {
          this.failureCounts.set(serverName, {
            count: persistentHealth.count,
            lastFailure: lastFailureTime,
          });
        } else if (!globalIsFresh) {
          // Clear stale global state
          this.failureCounts.delete(serverName);
        }
      }

      const failure = this.failureCounts.get(serverName);
      if (failure && failure.count >= this.MAX_FAILURES) {
        const backoffFactor = Math.pow(2, Math.min(failure.count - this.MAX_FAILURES, 4));
        const retryDelay = this.FAILURE_RESET_MS * backoffFactor;
        const timeSinceFailure = Date.now() - (failure.lastFailure ?? 0);

        if (timeSinceFailure < retryDelay) {
          logger.warn(
            `Circuit breaker OPEN for ${serverName} (Global count: ${failure.count}). Retrying in ${Math.round((retryDelay - timeSinceFailure) / 1000)}s`
          );
          throw new Error(
            `Circuit breaker open for ${serverName} after ${failure.count} failures. Retrying in ${Math.round((retryDelay - timeSinceFailure) / 1000)}s`
          );
        } else {
          logger.info(`Circuit breaker HALF-OPEN for ${serverName}, attempting probe connection.`);
        }
      }

      if (
        persistentHealth?.status === 'down' &&
        Date.now() - persistentHealth.timestamp < this.FAILURE_RESET_MS
      ) {
        logger.warn(`Server ${serverName} is marked as DOWN globally. skipping.`);
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
        // Regex to split by space but keep quoted strings together
        const parts = connectionString.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        if (parts.length === 0) {
          throw new Error(`Invalid empty connection string for MCP server ${serverName}`);
        }
        let command = parts[0].replace(/^"|"$/g, '');
        const args = parts.slice(1).map((arg) => arg.replace(/^"|"$/g, ''));

        // Resolve npx full path if needed (especially for Lambda)
        if (command === 'npx') {
          const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
          const allowedLocalInLambda = ['filesystem', 'ast'];
          if (isLambda && !allowedLocalInLambda.includes(serverName)) {
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

      // B2 Fix: Use empty string as default to properly detect non-hub URLs
      const hubUrl = process.env.MCP_HUB_URL ?? '';
      const isHub =
        connectionString.startsWith('http') && hubUrl !== '' && connectionString.includes(hubUrl);
      // Reduce timeout for local/remote MCP servers to prevent Lambda and dashboard timeouts
      // 15s allows the application to handle failure before a 30s Lambda timeout
      const connectTimeout = isHub ? 5000 : 15000;
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
          count: 0,
          timestamp: Date.now(),
        });
      } catch (error) {
        // Increment failure count and mark as down in DynamoDB (Global state sync)
        const prev = this.failureCounts.get(serverName) ?? { count: 0, lastFailure: 0 };
        const newCount = prev.count + 1;
        const lastFailure = Date.now();
        this.failureCounts.set(serverName, {
          count: newCount,
          lastFailure,
        });

        await AgentRegistry.saveRawConfig(`mcp_health_${serverName}`, {
          status: newCount >= this.MAX_FAILURES ? 'down' : 'degraded',
          count: newCount,
          lastFailure,
          timestamp: lastFailure,
        });

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
    this.connecting.set(cacheKey, connectingPromise);

    try {
      client = await connectingPromise;
      if (client) {
        this.clients.set(cacheKey, client);
      }
      return client;
    } finally {
      this.connecting.delete(cacheKey);
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
            path: `/mcp/${this.serverName}`,
            headers: {
              'Content-Type': 'application/json',
              'x-mcp-server': this.serverName,
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
          const body = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
          this.onmessage(body);
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
