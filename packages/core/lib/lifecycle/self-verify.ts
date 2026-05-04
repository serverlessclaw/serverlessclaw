import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SelfVerificationStatus } from '../types/system';
import { GapStatus } from '../types/index';
import { runDeepHealthCheck } from './health';
import { getMemoryTableName, getConfigTableName } from '../utils/ddb-client';

// Default client for backward compatibility - can be overridden via constructor for testing
const defaultDdbClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultDdbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Self-Verification Engine
 *
 * Provides automated health checks for the system's evolution, resilience, and awareness mechanisms.
 * @since 2026-03-19
 */
export class SelfVerifier {
  private readonly docClient: DynamoDBDocumentClient;

  /**
   * Creates a new SelfVerifier instance.
   * @param docClient - Optional DynamoDB Document Client for dependency injection (useful for testing)
   */
  constructor(docClient?: DynamoDBDocumentClient) {
    this.docClient = docClient ?? defaultDocClient;
  }

  /**
   * Performs a comprehensive audit of all "Self" mechanisms.
   */
  async verifyAll(): Promise<SelfVerificationStatus> {
    const [evolution, resilience, awareness] = await Promise.all([
      this.verifyEvolution(),
      this.verifyResilience(),
      this.verifyAwareness(),
    ]);

    return { evolution, resilience, awareness };
  }

  /**
   * Verifies the evolution mechanism by checking gap statistics.
   */
  async verifyEvolution() {
    const memoryTable = getMemoryTableName();

    if (!memoryTable) {
      return { totalGaps: 0, activeGaps: 0, fixSuccessRate: 100 };
    }

    // Scan for all GAPs
    const gapResult = await this.docClient.send(
      new ScanCommand({
        TableName: memoryTable,
        FilterExpression: 'begins_with(id, :gapPrefix)',
        ExpressionAttributeValues: {
          ':gapPrefix': 'GAP#',
        },
      })
    );

    const gaps = gapResult.Items ?? [];
    const totalGaps = gaps.length;
    const activeGaps = gaps.filter(
      (g) => g.status === GapStatus.OPEN || g.status === GapStatus.PROGRESS
    ).length;
    const doneGaps = gaps.filter((g) => g.status === GapStatus.DONE).length;
    const failedGaps = gaps.filter((g) => g.status === GapStatus.FAILED).length;

    // Success rate explicitly excludes ARCHIVED gaps and relies only on resolved states
    const resolvedCount = doneGaps + failedGaps;
    const fixSuccessRate = resolvedCount > 0 ? (doneGaps / resolvedCount) * 100 : 100;

    return { totalGaps, activeGaps, fixSuccessRate };
  }

  /**
   * Verifies the resilience mechanism by checking circuit breakers and health probes.
   */
  async verifyResilience() {
    const memoryTable = getMemoryTableName();
    const configTable = getConfigTableName();

    if (!memoryTable || !configTable) {
      return {
        circuitBreakerActive: false,
        deployCountToday: 0,
        apiHealthy: false,
      };
    }

    // 1. Get Limits from Config
    const configRes = await this.docClient.send(
      new GetCommand({
        TableName: configTable,
        Key: { id: 'system:config' },
      })
    );
    const deployLimit = configRes.Item?.deploy_limit ?? 5;

    // 2. Check Circuit Breaker State
    const statsResult = await this.docClient.send(
      new GetCommand({
        TableName: memoryTable,
        Key: { id: 'system:deploy-stats' },
      })
    );

    const stats = statsResult.Item ?? { count: 0 };
    const deployCountToday = stats.count;
    const circuitBreakerActive = deployCountToday >= deployLimit;

    // 3. Perform Deep Health Check (Non-mocked)
    const healthResult = await runDeepHealthCheck();

    return {
      circuitBreakerActive,
      deployCountToday,
      apiHealthy: healthResult.ok,
    };
  }

  /**
   * Verifies the awareness mechanism by checking topology discovery.
   */
  async verifyAwareness() {
    const configTable = getConfigTableName();

    if (!configTable) {
      return {
        nodeCount: 0,
        lastScanTimestamp: undefined,
        registryCoverage: 100,
      };
    }

    // 1. Check discovered nodes
    const topoResult = await this.docClient.send(
      new GetCommand({
        TableName: configTable,
        Key: { id: 'topology:current' },
      })
    );

    const topo = topoResult.Item ?? { nodes: [], edges: [], updatedAt: undefined };
    const nodeCount = topo.nodes.length;
    const lastScanTimestamp = topo.updatedAt;

    // 2. Registry Coverage
    // Compare agents in registry vs agents in topology
    const registryResult = await this.docClient.send(
      new ScanCommand({
        TableName: configTable,
        FilterExpression: 'begins_with(id, :agentPrefix)',
        ExpressionAttributeValues: {
          ':agentPrefix': 'AGENT#',
        },
      })
    );

    const registeredAgents = registryResult.Items ?? [];
    const agentsInTopo = topo.nodes.filter((n: { type: string }) => n.type === 'agent').length;

    const registryCoverage =
      registeredAgents.length > 0 ? (agentsInTopo / registeredAgents.length) * 100 : 100;

    return {
      nodeCount,
      lastScanTimestamp,
      registryCoverage: Math.min(registryCoverage, 100),
    };
  }
}
