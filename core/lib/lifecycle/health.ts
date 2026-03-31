import { EventBridgeClient, ListEventBusesCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { IoTClient, DescribeEndpointCommand } from '@aws-sdk/client-iot';
import { Resource } from 'sst';
import { EventType } from '../types/agent';
import { SSTResource } from '../types/system';
import { logger } from '../logger';
import { emitEvent, EventPriority } from '../utils/bus';
import { formatErrorMessage } from '../utils/error';
import { ProviderManager } from '../providers';

// Default clients for backward compatibility - can be overridden for testing
const defaultEventBridge = new EventBridgeClient({});
const defaultDynamodb = new DynamoDBClient({});
const defaultS3 = new S3Client({});
const defaultIot = new IoTClient({});

// Allow tests to inject custom clients
let injectedEventBridge: EventBridgeClient | undefined;
let injectedDynamodb: DynamoDBClient | undefined;
let injectedS3: S3Client | undefined;
let injectedIot: IoTClient | undefined;

/**
 * Sets a custom EventBridge client for testing purposes.
 * @param client - The EventBridge client to use
 */
export function setEventBridgeClient(client: EventBridgeClient): void {
  injectedEventBridge = client;
}

/**
 * Sets a custom DynamoDB client for testing purposes.
 * @param client - The DynamoDB client to use
 */
export function setDynamoDbClient(client: DynamoDBClient): void {
  injectedDynamodb = client;
}

/**
 * Sets a custom S3 client for testing purposes.
 */
export function setS3Client(client: S3Client): void {
  injectedS3 = client;
}

/**
 * Sets a custom IoT client for testing purposes.
 */
export function setIotClient(client: IoTClient): void {
  injectedIot = client;
}

function getEventBridgeClient(): EventBridgeClient {
  return injectedEventBridge ?? defaultEventBridge;
}

function getDynamoDbClient(): DynamoDBClient {
  return injectedDynamodb ?? defaultDynamodb;
}

function getS3Client(): S3Client {
  return injectedS3 ?? defaultS3;
}

function getIotClient(): IoTClient {
  return injectedIot ?? defaultIot;
}

export interface HealthIssue {
  component: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  userId: string;
  traceId?: string;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface CognitiveHealthResult {
  ok: boolean;
  timestamp: number;
  results: {
    bus: ProbeResult;
    tools: ProbeResult;
    providers: ProbeResult;
  };
  summary: string;
}

/**
 * Reports a system health issue to the AgentBus for autonomous triage.
 * @param report - High-level health event to be published
 */
export async function reportHealthIssue(report: HealthIssue): Promise<void> {
  logger.warn(`Reporting system health issue in ${report.component}: ${report.issue}`, {
    severity: report.severity,
    traceId: report.traceId,
  });

  const priority =
    report.severity === 'critical' || report.severity === 'high'
      ? EventPriority.CRITICAL
      : report.severity === 'medium'
        ? EventPriority.HIGH
        : EventPriority.NORMAL;

  try {
    await emitEvent(
      'system.health',
      EventType.SYSTEM_HEALTH_REPORT,
      report as unknown as Record<string, unknown>,
      { priority }
    );
    logger.info(`Health issue reported successfully for component: ${report.component}`);
  } catch (error) {
    logger.error('Failed to report system health issue:', error);
  }
}

/**
 * Verifies connectivity to the EventBridge AgentBus.
 */
export async function checkAgentBus(): Promise<ProbeResult> {
  const typedResource = Resource as unknown as SSTResource;
  const start = Date.now();
  try {
    await getEventBridgeClient().send(
      new ListEventBusesCommand({
        NamePrefix: typedResource.AgentBus.name,
      })
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, error: formatErrorMessage(error) };
  }
}

/**
 * Verifies connectivity to critical storage and messaging tools.
 */
export async function checkToolHealth(): Promise<ProbeResult> {
  const typedResource = Resource as unknown as SSTResource;
  const start = Date.now();
  const details: Record<string, any> = {};
  let overallOk = true;

  // 1. DynamoDB Checks
  const ddbTables = [
    { name: 'MemoryTable', resource: typedResource.MemoryTable },
    { name: 'TraceTable', resource: typedResource.TraceTable },
    { name: 'ConfigTable', resource: typedResource.ConfigTable },
  ];

  for (const table of ddbTables) {
    try {
      const dbStart = Date.now();
      let key: Record<string, any>;

      if (table.name === 'ConfigTable') {
        key = { key: { S: 'HEALTH#PROBE' } };
      } else if (table.name === 'TraceTable') {
        key = {
          traceId: { S: 'HEALTH#PROBE' },
          nodeId: { S: 'HEALTH#PROBE' },
        };
      } else {
        // MemoryTable
        key = {
          userId: { S: 'HEALTH#PROBE' },
          timestamp: { N: '0' },
        };
      }

      await getDynamoDbClient().send(
        new GetItemCommand({
          TableName: table.resource.name,
          Key: key,
        })
      );
      details[table.name.toLowerCase()] = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (error) {
      // MemoryTable is critical, others might be less so but still important
      if (table.name === 'MemoryTable') overallOk = false;
      details[table.name.toLowerCase()] = { ok: false, error: formatErrorMessage(error) };
    }
  }

  try {
    // 2. S3 Checks
    const s3Start = Date.now();
    await getS3Client().send(new ListBucketsCommand({}));
    details.s3 = { ok: true, latencyMs: Date.now() - s3Start };

    // Check specific buckets if possible
    details.stagingBucket = { ok: true, name: typedResource.StagingBucket.name };
    details.knowledgeBucket = { ok: true, name: typedResource.KnowledgeBucket.name };
  } catch (error) {
    details.s3 = { ok: false, error: formatErrorMessage(error) };
  }

  try {
    // 3. IoT Core Check
    const iotStart = Date.now();
    await getIotClient().send(new DescribeEndpointCommand({ endpointType: 'iot:Data-ATS' }));
    details.iot = { ok: true, latencyMs: Date.now() - iotStart };
  } catch (error) {
    details.iot = { ok: false, error: formatErrorMessage(error) };
  }

  return {
    ok: overallOk,
    latencyMs: Date.now() - start,
    details,
  };
}

/**
 * Verifies connectivity to LLM providers.
 */
export async function checkProviderHealth(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const providerManager = new ProviderManager();
    // Use getCapabilities as a lightweight "ping" if possible, or just check provider availability
    const capabilities = await providerManager.getCapabilities();
    return {
      ok: true,
      latencyMs: Date.now() - start,
      details: {
        provider: providerManager.getActiveProviderName(),
        model: providerManager.getActiveModelName(),
        supportsStructuredOutput: capabilities.supportsStructuredOutput,
      },
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, error: formatErrorMessage(error) };
  }
}

/**
 * Performs a comprehensive cognitive health check across the swarm.
 */
export async function checkCognitiveHealth(): Promise<CognitiveHealthResult> {
  logger.info('[Health] Starting deep cognitive health check...');

  const [bus, tools, providers] = await Promise.all([
    checkAgentBus(),
    checkToolHealth(),
    checkProviderHealth(),
  ]);

  const ok = bus.ok && tools.ok && providers.ok;
  const timestamp = Date.now();

  let summary = 'System cognitive health is optimal.';
  if (!ok) {
    const failures = [];
    if (!bus.ok) failures.push('AgentBus');
    if (!tools.ok) failures.push('Core Tools');
    if (!providers.ok) failures.push('LLM Providers');
    summary = `Cognitive degradation detected in: ${failures.join(', ')}.`;
  }

  return {
    ok,
    timestamp,
    results: { bus, tools, providers },
    summary,
  };
}

/**
 * Standard deep health check interface for backward compatibility.
 */
export async function runDeepHealthCheck(): Promise<{ ok: boolean; details?: string }> {
  const result = await checkCognitiveHealth();
  return {
    ok: result.ok,
    details: result.ok
      ? result.summary
      : `${result.summary} Details: ${JSON.stringify(result.results)}`,
  };
}
