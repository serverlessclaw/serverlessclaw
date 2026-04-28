import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { BaseMemoryProvider } from '../memory/base';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SessionState } from '../session/session-state';

const lambdaClient = new LambdaClient({});

export interface WarmupConfig {
  servers: Record<string, string>; // serverName -> ARN
  agents: Record<string, string>; // agentName -> ARN
  ttlSeconds: number; // How long warm state is valid
}

export interface WarmupState {
  server: string;
  lastWarmed: string; // ISO timestamp
  warmedBy: 'webhook' | 'scheduler' | 'recovery';
  ttl: number; // Unix timestamp for expiration
  latencyMs?: number;
  coldStart?: boolean;
}

export interface WarmupEvent {
  type: 'WARMUP';
  source: string;
  userChatId?: string;
  intent?: string;
}

/**
 * Smart Warmup Manager
 * Tracks warm state and provides intent-based warmup instead of rigid scheduling.
 */
export class WarmupManager extends BaseMemoryProvider {
  private readonly config: WarmupConfig;

  private get ttlSeconds(): number {
    return this.config.ttlSeconds ?? 900; // Default 15 minutes
  }

  constructor(config: WarmupConfig, docClient?: DynamoDBDocumentClient) {
    super(docClient);
    this.config = config;
  }

  /**
   * Check if a server is currently warm (has recent warm state).
   */
  async isServerWarm(serverName: string, workspaceId?: string): Promise<boolean> {
    try {
      const item = await this.getWarmState(serverName, workspaceId);
      if (!item) return false;

      const now = Math.floor(Date.now() / 1000);
      return item.ttl > now;
    } catch (error) {
      logger.warn(`[WARMUP] Failed to check warm state for ${serverName}:`, error);
      return false;
    }
  }

  /**
   * Get warm state for a server from DynamoDB.
   */
  async getWarmState(serverName: string, workspaceId?: string): Promise<WarmupState | null> {
    try {
      const pk = `WARM#${serverName}`;
      const scopedPk = this.getScopedUserId(pk, { workspaceId });

      const items = await this.queryItemsPaginated({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': scopedPk,
          ':sk': 'STATE',
        },
      });
      return items.items.length > 0 ? (items.items[0] as unknown as WarmupState) : null;
    } catch (error) {
      logger.warn(`[WARMUP] Failed to get warm state for ${serverName}:`, error);
      return null;
    }
  }

  /**
   * Record warm state after successful warmup.
   */
  async recordWarmState(state: WarmupState, workspaceId?: string): Promise<void> {
    try {
      const pk = `WARM#${state.server}`;
      const scopedPk = this.getScopedUserId(pk, { workspaceId });

      await this.putItem({
        pk: scopedPk,
        sk: 'STATE',
        ...state,
        workspaceId,
      });
      logger.info(
        `[WARMUP] Recorded warm state for ${state.server} (WS: ${workspaceId || 'global'})`
      );
    } catch (error) {
      logger.error(`[WARMUP] Failed to record warm state for ${state.server}:`, error);
      throw error;
    }
  }

  /**
   * Warm a specific MCP server and record state.
   */
  async warmMcpServer(
    serverName: string,
    warmedBy: 'webhook' | 'scheduler' | 'recovery' = 'webhook',
    workspaceId?: string
  ): Promise<WarmupState> {
    const arn = this.config.servers[serverName];
    if (!arn) {
      throw new Error(`MCP server ${serverName} not found in config`);
    }

    const startTime = Date.now();

    try {
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'warmup',
            version: '1.0.0',
          },
        },
      };

      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: arn,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            httpMethod: 'POST',
            path: `/mcp/${serverName}`,
            headers: {
              'Content-Type': 'application/json',
              'x-mcp-server': serverName,
            },
            body: JSON.stringify(jsonRpcRequest),
            workspaceId,
          }),
        })
      );

      const latencyMs = Date.now() - startTime;

      // Check if this was likely a cold start (latency > 2 seconds)
      const coldStart = latencyMs > 2000;

      const state: WarmupState = {
        server: serverName,
        lastWarmed: new Date().toISOString(),
        warmedBy,
        ttl: Math.floor(Date.now() / 1000) + this.ttlSeconds,
        latencyMs,
        coldStart,
      };

      await this.recordWarmState(state, workspaceId);
      return state;
    } catch (error) {
      logger.error(`[WARMUP] Failed to warm MCP server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Identify which agent/multiplexer buckets are likely needed based on message intent
   * and session history (User-Activity Based).
   */
  async identifyTargets(text: string, sessionState: SessionState | null = null): Promise<string[]> {
    const targets = new Set<string>();
    const lowerText = text.toLowerCase();

    // 1. High-Power Intent (Technical/Strategic)
    if (
      /(code|implement|refactor|fix|research|investigate|search|google|aws|infra|sst|lambda|deployment|issue|pr)/i.test(
        lowerText
      )
    ) {
      targets.add('high');
    }

    // 2. Standard Intent (QA/Communication)
    if (/(qa|test|verify|chat|talk|hello|hi|help|explain|summary)/i.test(lowerText)) {
      targets.add('standard');
    }

    // 3. Light Intent (Review/Structural)
    if (/(review|critique|merge|conflict|reconcile|fact-check)/i.test(lowerText)) {
      targets.add('light');
    }

    // 4. Session Affinity (Stay warm if we were just working with a specific agent)
    // Note: If SuperClaw is the entry point, it often indicates the whole suite might be needed.
    if (sessionState?.processingAgentId) {
      const last = sessionState.processingAgentId.toLowerCase();
      if (last.includes('coder') || last.includes('researcher')) targets.add('high');
      if (last.includes('qa') || last.includes('facilitator')) targets.add('standard');
      if (last.includes('critic') || last.includes('merger')) targets.add('light');
    }

    // Default to 'high' for empty or ambiguous messages to be safe
    if (targets.size === 0) {
      targets.add('high');
    }

    return Array.from(targets);
  }

  /**
   * Warm a specific agent Lambda and record state.
   * For the 3-tier multiplexer, the recorder state is usually handled by the
   * destination Lambda itself after successful initialization for maximum accuracy.
   */
  async warmAgent(
    agentName: string,
    warmedBy: 'webhook' | 'scheduler' | 'recovery' = 'webhook',
    shouldRecordLocally: boolean = false,
    workspaceId?: string
  ): Promise<WarmupState> {
    const arn = this.config.agents[agentName];
    if (!arn) {
      throw new Error(`Agent/Multiplexer ${agentName} not found in config`);
    }

    const startTime = Date.now();

    try {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: arn,
          InvocationType: 'Event', // Async fire-and-forget
          Payload: JSON.stringify({
            type: 'WARMUP',
            source: 'warmup-manager',
            intent: 'proactive-smart-warmup',
            workspaceId,
          }),
        })
      );

      const latencyMs = Date.now() - startTime;

      const state: WarmupState = {
        server: agentName,
        lastWarmed: new Date().toISOString(),
        warmedBy,
        ttl: Math.floor(Date.now() / 1000) + this.ttlSeconds,
        latencyMs,
        coldStart: false,
      };

      if (shouldRecordLocally) {
        await this.recordWarmState(state, workspaceId);
      }

      return state;
    } catch (error) {
      logger.error(`[WARMUP] Failed to warm agent ${agentName}:`, error);
      throw error;
    }
  }

  /**
   * Smart warmup: only warm servers/agents that are cold based on intent or explicit requests.
   * Returns list of actually warmed servers (skips warm ones).
   */
  async smartWarmup(options: {
    servers?: string[];
    agents?: string[];
    intent?: string;
    sessionState?: SessionState | null;
    warmedBy?: 'webhook' | 'scheduler' | 'recovery';
    workspaceId?: string;
  }): Promise<{ servers: string[]; agents: string[] }> {
    const warmedServers: string[] = [];
    const warmedAgents: string[] = [];

    const agentsToWarm = options.agents ? [...options.agents] : [];

    // If intent is provided, proactively identify agent tiers to warm
    if (options.intent) {
      const identifiedTiers = await this.identifyTargets(options.intent, options.sessionState);
      identifiedTiers.forEach((tier) => {
        if (!agentsToWarm.includes(tier)) {
          agentsToWarm.push(tier);
        }
      });
    }

    // Warm MCP servers
    if (options.servers) {
      for (const server of options.servers) {
        const isWarm = await this.isServerWarm(server, options.workspaceId);
        if (!isWarm) {
          try {
            await this.warmMcpServer(server, options.warmedBy || 'webhook', options.workspaceId);
            warmedServers.push(server);
          } catch (error) {
            logger.warn(`[WARMUP] Failed to warm server ${server}:`, error);
          }
        } else {
          logger.info(`[WARMUP] Server ${server} already warm, skipping`);
        }
      }
    }

    // Warm agents
    if (agentsToWarm.length > 0) {
      for (const agent of agentsToWarm) {
        const isWarm = await this.isServerWarm(agent, options.workspaceId);
        if (!isWarm) {
          try {
            await this.warmAgent(agent, options.warmedBy || 'webhook', true, options.workspaceId);
            warmedAgents.push(agent);
          } catch (error) {
            logger.warn(`[WARMUP] Failed to warm agent ${agent}:`, error);
          }
        } else {
          logger.info(`[WARMUP] Agent ${agent} already warm, skipping`);
        }
      }
    }

    return { servers: warmedServers, agents: warmedAgents };
  }

  /**
   * Get all currently warm servers/agents.
   */
  async getWarmServers(workspaceId?: string): Promise<WarmupState[]> {
    try {
      const pkPrefix = this.getScopedUserId('WARM#', { workspaceId });

      const items = await this.queryItemsPaginated({
        TableName: this.tableName,
        KeyConditionExpression: 'begins_with(pk, :prefix) AND sk = :sk',
        ExpressionAttributeValues: {
          ':prefix': pkPrefix,
          ':sk': 'STATE',
        },
      });

      const now = Math.floor(Date.now() / 1000);
      return items.items
        .map((item) => item as unknown as WarmupState)
        .filter((state) => state.ttl > now);
    } catch (error) {
      logger.error('[WARMUP] Failed to get warm servers:', error);
      return [];
    }
  }

  /**
   * Clean up expired warm states.
   */
  async cleanupExpiredStates(workspaceId?: string): Promise<number> {
    try {
      const pkPrefix = this.getScopedUserId('WARM#', { workspaceId });

      const items = await this.queryItemsPaginated({
        TableName: this.tableName,
        KeyConditionExpression: 'begins_with(pk, :prefix) AND sk = :sk',
        ExpressionAttributeValues: {
          ':prefix': pkPrefix,
          ':sk': 'STATE',
        },
      });

      const now = Math.floor(Date.now() / 1000);
      let deleted = 0;

      for (const item of items.items) {
        const state = item as Record<string, unknown>;
        if (typeof state.ttl === 'number' && state.ttl <= now) {
          await this.docClient.send(
            new DeleteCommand({
              TableName: this.tableName,
              Key: {
                pk: item.pk,
                sk: 'STATE',
              },
            })
          );
          deleted++;
        }
      }

      logger.info(
        `[WARMUP] Cleaned up ${deleted} expired warm states (WS: ${workspaceId || 'global'})`
      );
      return deleted;
    } catch (error) {
      logger.error('[WARMUP] Failed to cleanup expired states:', error);
      return 0;
    }
  }
}
