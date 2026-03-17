import { EventBridgeClient, ListEventBusesCommand } from '@aws-sdk/client-eventbridge';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { Resource } from 'sst';
import { EventType, SSTResource } from './types/index';
import { logger } from './logger';
import { emitEvent } from './utils/bus';
import { formatErrorMessage } from './utils/error';

const eventbridge = new EventBridgeClient({});
const dynamodb = new DynamoDBClient({});

export interface HealthIssue {
  component: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  userId: string;
  traceId?: string;
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

  try {
    await emitEvent(
      'system.health',
      EventType.SYSTEM_HEALTH_REPORT,
      report as unknown as Record<string, unknown>
    );
    logger.info(`Health issue reported successfully for component: ${report.component}`);
  } catch (error) {
    logger.error('Failed to report system health issue:', error);
  }
}

/**
 * Performs a deep health check by executing a full data circuit:
 * 1. Write pulse to DynamoDB
 * 2. Read pulse back
 * 3. Delete pulse
 * 4. Verify EventBridge connectivity
 */
export async function runDeepHealthCheck(): Promise<{ ok: boolean; details?: string }> {
  const typedResource = Resource as unknown as SSTResource;
  const pulseId = `PULSE#${Date.now()}`;
  const PROBE_TS = 999; // Use a dedicated fixed timestamp for health probes

  try {
    // 1. DynamoDB Circuit Check
    logger.info('Deep Health: Verifying DynamoDB circuit...');
    await dynamodb.send(
      new PutItemCommand({
        TableName: typedResource.MemoryTable.name,
        Item: {
          userId: { S: 'SYSTEM#HEALTH#PROBE' },
          timestamp: { N: PROBE_TS.toString() },
          content: { S: pulseId },
          type: { S: 'PROBE' },
          expiresAt: { N: (Math.floor(Date.now() / 1000) + 60).toString() }, // 1 min TTL
        },
      })
    );

    const getRes = await dynamodb.send(
      new GetItemCommand({
        TableName: typedResource.MemoryTable.name,
        Key: {
          userId: { S: 'SYSTEM#HEALTH#PROBE' },
          timestamp: { N: PROBE_TS.toString() },
        },
      })
    );

    if (getRes.Item?.content?.S !== pulseId) {
      throw new Error('DynamoDB pulse verification failed: content mismatch');
    }

    await dynamodb.send(
      new DeleteItemCommand({
        TableName: typedResource.MemoryTable.name,
        Key: {
          userId: { S: 'SYSTEM#HEALTH#PROBE' },
          timestamp: { N: PROBE_TS.toString() },
        },
      })
    );

    // 2. EventBridge Connectivity Check
    logger.info('Deep Health: Verifying EventBridge connectivity...');
    await eventbridge.send(
      new ListEventBusesCommand({
        NamePrefix: typedResource.AgentBus.name,
      })
    );

    return { ok: true };
  } catch (error) {
    const msg = formatErrorMessage(error);
    logger.error(`Deep Health Check FAILED: ${msg}`);
    return { ok: false, details: msg };
  }
}
