import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from '../logger';
import { MCP } from '../constants/tools';
import { TRANSPORT_DEFAULTS } from './mcp-defaults';

interface Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
}

const lambdaClient = new LambdaClient({});

/**
 * Manages the lifecycle and connections of MCP clients.
 */
export class MCPClientManager {
  private static clients: Map<string, Client> = new Map();
  private static connecting: Map<string, Promise<Client>> = new Map();
  private static connectionTimestamps: Map<string, number> = new Map();
  private static readonly CONNECTION_TTL_MS = parseInt(
    process.env.MCP_CONNECTION_TTL_MS ?? String(MCP.CONNECTION_TTL_MS)
  );

  static getClient(name: string, workspaceId?: string): Client | undefined {
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';
    const cacheKey = `${scopePrefix}${name}`;

    const client = this.clients.get(cacheKey);
    if (client) return client;

    for (const [key, val] of this.clients.entries()) {
      if (key.startsWith(`${cacheKey}:`)) return val;
    }
    return undefined;
  }

  static deleteClient(name: string, workspaceId?: string): void {
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';
    const prefixKey = `${scopePrefix}${name}`;

    for (const key of Array.from(this.clients.keys())) {
      if (key === prefixKey || key.startsWith(`${prefixKey}:`)) {
        const client = this.clients.get(key);
        client?.close().catch(() => {});
        this.clients.delete(key);
        this.connectionTimestamps.delete(key);
      }
    }
    for (const key of Array.from(this.connecting.keys())) {
      if (key === prefixKey || key.startsWith(`${prefixKey}:`)) {
        this.connecting.delete(key);
      }
    }
  }

  /**
   * Connect to an MCP server using the appropriate transport.
   */
  static async connect(
    serverName: string,
    connectionString: string,
    env?: Record<string, string>,
    workspaceId?: string
  ): Promise<Client> {
    const isLocal = this.isLocalConnection(connectionString);
    const cwd = process.cwd();
    const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';
    const cacheKey = isLocal ? `${scopePrefix}${serverName}:${cwd}` : `${scopePrefix}${serverName}`;

    let client = this.clients.get(cacheKey);
    if (client) return client;

    let connectingPromise = this.connecting.get(cacheKey);
    if (connectingPromise) return await connectingPromise;

    connectingPromise = this.performConnect(
      serverName,
      connectionString,
      cacheKey,
      env,
      workspaceId
    );
    this.connecting.set(cacheKey, connectingPromise);

    try {
      client = await connectingPromise;
      if (client) {
        this.clients.set(cacheKey, client);
        this.connectionTimestamps.set(cacheKey, Date.now());
      }
      return client;
    } finally {
      this.connecting.delete(cacheKey);
    }
  }

  private static async performConnect(
    serverName: string,
    connectionString: string,
    cacheKey: string,
    env?: Record<string, string>,
    workspaceId?: string
  ): Promise<Client> {
    const { getCircuitBreaker } = await import('../safety');
    const cb = getCircuitBreaker(`mcp_health_${serverName}`, workspaceId);
    const cbResult = await cb.canProceed('autonomous');

    if (!cbResult.allowed) {
      logger.warn(
        `Circuit breaker OPEN for ${serverName} (WS: ${workspaceId || 'global'}): ${cbResult.reason}`
      );
      throw new Error(`Circuit breaker open for ${serverName}: ${cbResult.reason}`);
    }

    logger.info(`Starting new connection for ${serverName} (WS: ${workspaceId || 'global'})`);
    const transport = await TransportFactory.createTransport(serverName, connectionString, {
      ...env,
      workspaceId,
    } as any);

    const newClient = new Client(
      { name: 'ServerlessClaw-Client', version: '1.0.0' },
      { capabilities: {} }
    );

    const hubUrl = process.env.MCP_HUB_URL ?? '';
    const isHub =
      connectionString.startsWith('http') && hubUrl !== '' && connectionString.includes(hubUrl);
    const connectTimeout = isHub ? MCP.HUB_CONNECT_TIMEOUT_MS : MCP.DEFAULT_CONNECT_TIMEOUT_MS;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`MCP Connection timeout after ${connectTimeout}ms`)),
        connectTimeout
      );
    });

    try {
      await Promise.race([newClient.connect(transport), timeoutPromise]);
      await cb.recordSuccess();
    } catch (error) {
      await cb.recordFailure('connection');
      logger.error(`Failed to connect to MCP server ${serverName}:`, error);

      await transport.close().catch(() => {});
      await newClient.close().catch(() => {});
      throw error;
    }

    transport.onclose = () => {
      logger.warn(`MCP Server connection closed: ${cacheKey}`);
      this.clients.delete(cacheKey);
      this.connectionTimestamps.delete(cacheKey);
    };

    return newClient;
  }

  private static isLocalConnection(conn: string): boolean {
    return !conn.startsWith('http') && !conn.startsWith('arn:aws:lambda:');
  }

  private static evictStaleConnections(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.connectionTimestamps.entries()) {
      if (now - timestamp > this.CONNECTION_TTL_MS) {
        const client = this.clients.get(key);
        if (client) {
          client.close().catch(() => {});
          this.clients.delete(key);
          this.connectionTimestamps.delete(key);
          logger.info(`[MCP] Evicted stale connection: ${key}`);
        }
      }
    }
  }

  static maybeEvictStaleConnections(): void {
    if (Math.random() < 0.01) {
      this.evictStaleConnections();
    }
  }

  static async closeAll(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map((c) => c.close());
    await Promise.all(closePromises);
    this.clients.clear();
    this.connecting.clear();
    this.connectionTimestamps.clear();
  }
}

class TransportFactory {
  static async createTransport(
    serverName: string,
    connectionString: string,
    env?: Record<string, string>
  ): Promise<Transport> {
    if (connectionString.startsWith('arn:aws:lambda:')) {
      return new LambdaInvokeTransport(connectionString, serverName, (env as any)?.workspaceId);
    }

    if (connectionString.startsWith('http')) {
      return new SSEClientTransport(new URL(connectionString));
    }

    return await this.createStdioTransport(serverName, connectionString, {
      ...env,
      workspaceId: (env as any)?.workspaceId,
    } as any);
  }

  private static async createStdioTransport(
    serverName: string,
    connectionString: string,
    env?: Record<string, string>
  ): Promise<Transport> {
    const parts = connectionString.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (parts.length === 0 || !parts[0]) {
      throw new Error(`Invalid empty connection string for MCP server ${serverName}`);
    }

    let command = parts[0].replace(/^"|"$/g, '');
    const args = parts.slice(1).map((arg) => arg.replace(/^"|"$/g, ''));

    if (command === 'npx') {
      command = await this.resolveNpxPath(serverName);
    }

    // Sanitize environment variables to prevent host secret leakage
    const SAFE_ENV_VARS = [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'NODE_PATH',
      'MCP_FILESYSTEM_PATH',
    ];
    const safeEnv: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
      if (process.env[key]) safeEnv[key] = process.env[key]!;
    }

    return new StdioClientTransport({
      command,
      args,
      env: {
        ...safeEnv,
        ...env,
        ...TRANSPORT_DEFAULTS.STDIO,
      },
    });
  }

  private static async resolveNpxPath(serverName: string): Promise<string> {
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (isLambda && !TRANSPORT_DEFAULTS.ALLOWED_LOCAL_IN_LAMBDA.includes(serverName)) {
      throw new Error(
        `Cannot spawn local MCP server '${serverName}' using npx in Lambda environment. Please use MCP_HUB_URL for external tools.`
      );
    }

    try {
      const { execSync } = await import('child_process');
      return execSync('which npx', { encoding: 'utf8' }).trim();
    } catch {
      const fs = await import('fs');
      const commonPaths = ['/var/lang/bin/npx', '/usr/bin/npx', '/usr/local/bin/npx'];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
      }
      return 'npx';
    }
  }
}

class LambdaInvokeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly functionArn: string,
    private readonly serverName: string,
    private readonly workspaceId?: string
  ) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    try {
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
              'x-workspace-id': this.workspaceId || '',
            },
            body: JSON.stringify(message),
          }),
        })
      );

      if (result.FunctionError) {
        throw new Error(`Lambda function error: ${result.FunctionError}`);
      }

      if (result.Payload && this.onmessage) {
        const payload = JSON.parse(Buffer.from(result.Payload).toString());
        if (payload.statusCode !== 200) {
          throw new Error(`MCP server returned error: ${payload.body}`);
        }
        const body = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
        this.onmessage(body);
      }
    } catch (error) {
      if (this.onerror) {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}
