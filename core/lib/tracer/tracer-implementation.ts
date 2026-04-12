import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/system';
import { TraceSource } from '../types/agent';
import { v4 as uuidv4 } from 'uuid';
import { TRACE_STATUS, TIME } from '../constants';
import { logger } from '../logger';
import { filterPIIFromObject } from '../utils/pii';
import { getDocClient } from '../utils/ddb-client';
import type { TraceStep, Trace } from './types';
import { METRICS } from '../metrics/metrics';

// Removed local doc client management in favor of shared utility

/**
 * ClawTracer provides observability into an agent's internal reasoning process
 * by persisting steps and metadata to DynamoDB.
 */
export class ClawTracer {
  private traceId: string;
  private nodeId: string;
  private parentId?: string;
  private userId: string;
  private source: TraceSource | string;
  private agentId?: string;
  private startTime: number;
  private readonly docClient: DynamoDBDocumentClient;

  /**
   * Initializes a new ClawTracer instance.
   *
   * @param userId - Unique identifier for the user or session.
   * @param source - Origin of the request.
   * @param traceId - Unique ID for the entire conversation/workflow.
   * @param nodeId - Unique ID for this specific agent execution or branch.
   * @param parentId - Optional ID of the node that spawned this one.
   * @param agentId - Optional ID of the agent executing this trace.
   * @param docClient - Optional DynamoDB Document Client for dependency injection (useful for testing)
   */
  constructor(
    userId: string,
    source: TraceSource | string = TraceSource.UNKNOWN,
    traceId?: string,
    nodeId?: string,
    parentId?: string,
    agentId?: string,
    docClient?: DynamoDBDocumentClient
  ) {
    this.userId = userId;
    this.source = source;
    this.traceId = traceId ?? uuidv4();
    this.nodeId = nodeId ?? 'root';
    this.parentId = parentId;
    this.agentId = agentId;
    this.startTime = Date.now();
    this.docClient = docClient ?? getDocClient();
  }

  private getTableName(): string {
    const typedResource = Resource as unknown as SSTResource;
    return typedResource.TraceTable.name;
  }

  /**
   * Initializes a new trace node in DynamoDB.
   *
   * @param initialContext - Initial context for the trace (e.g., user input).
   * @returns A promise that resolves to the trace ID.
   */
  async startTrace(initialContext: Record<string, unknown>): Promise<string> {
    const { AgentRegistry } = await import('../registry');
    const days = await AgentRegistry.getRetentionDays('TRACES_DAYS');
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + days * TIME.SECONDS_IN_DAY;

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.getTableName(),
          Item: {
            traceId: this.traceId,
            nodeId: this.nodeId,
            parentId: this.parentId,
            userId: this.userId,
            source: this.source,
            agentId: this.agentId,
            timestamp: this.startTime,
            status: TRACE_STATUS.STARTED,
            initialContext,
            steps: [],
            expiresAt,
          },
          ConditionExpression: 'attribute_not_exists(traceId) AND attribute_not_exists(nodeId)',
        })
      );
      // Optionally maintain a summary item for this trace to support
      // one-row-per-trace listings in the dashboard. This is behind an
      // env flag to avoid changing test expectations by default.
      const summariesEnabled = process.env.TRACE_SUMMARIES_ENABLED === 'true';
      if (summariesEnabled && this.nodeId === 'root') {
        try {
          await this.docClient.send(
            new PutCommand({
              TableName: this.getTableName(),
              Item: {
                traceId: this.traceId,
                nodeId: '__summary__',
                userId: this.userId,
                source: this.source,
                agentId: this.agentId,
                timestamp: this.startTime,
                status: TRACE_STATUS.STARTED,
                title:
                  (initialContext as Record<string, unknown>)?.title ??
                  (initialContext as Record<string, unknown>)?.message ??
                  null,
                expiresAt,
              },
            })
          );
        } catch (summErr) {
          logger.warn(`Failed to create trace summary for ${this.traceId}:`, summErr);
        }
      }
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'name' in e &&
        e.name === 'ConditionalCheckFailedException'
      ) {
        logger.info(`Trace node ${this.traceId}/${this.nodeId} already exists, skipping.`);
      } else {
        throw e;
      }
    }
    return this.traceId;
  }

  /**
   * Spawns a new child tracer for parallel or delegated execution.
   *
   * @param newNodeId - Optional ID for the new node.
   * @param childAgentId - Optional ID for the agent executing the child trace.
   * @returns A new ClawTracer instance correctly linked to this parent.
   */
  getChildTracer(newNodeId?: string, childAgentId?: string): ClawTracer {
    return new ClawTracer(
      this.userId,
      this.source,
      this.traceId,
      newNodeId ?? uuidv4(),
      this.nodeId,
      childAgentId ?? this.agentId,
      this.docClient
    );
  }

  /**
   * Adds a step to the current trace node.
   *
   * @param step - The step content and type.
   * @returns A promise that resolves when the step is added.
   */
  async addStep(step: Omit<TraceStep, 'stepId' | 'timestamp'>): Promise<void> {
    const fullStep: TraceStep = filterPIIFromObject({
      ...step,
      stepId: uuidv4(),
      timestamp: Date.now(),
    }) as TraceStep;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: { traceId: this.traceId, nodeId: this.nodeId },
        UpdateExpression: 'SET #steps = list_append(if_not_exists(#steps, :empty_list), :step)',
        ExpressionAttributeNames: { '#steps': 'steps' },
        ExpressionAttributeValues: {
          ':step': [fullStep],
          ':empty_list': [],
        },
      })
    );

    // Update the trace summary's timestamp to reflect recent activity (only
    // update the one summary row maintained for the root node) when enabled.
    const summariesEnabled = process.env.TRACE_SUMMARIES_ENABLED === 'true';
    if (summariesEnabled && this.nodeId === 'root') {
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.getTableName(),
            Key: { traceId: this.traceId, nodeId: '__summary__' },
            UpdateExpression: 'SET #ts = :ts, lastStepType = :t',
            ExpressionAttributeNames: { '#ts': 'timestamp' },
            ExpressionAttributeValues: { ':ts': Date.now(), ':t': step.type },
          })
        );
      } catch (e) {
        // best-effort - do not fail main flow
        logger.warn(`Failed to update trace summary timestamp for ${this.traceId}:`, e);
      }
    }
  }

  /**
   * Ends the trace node with a final response and optional metadata.
   *
   * @param finalResponse - The final response sent to the user.
   * @param metadata - Additional metadata for the trace.
   * @returns A promise that resolves when the trace is closed.
   */
  async endTrace(finalResponse: string, metadata?: Record<string, unknown>): Promise<void> {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: { traceId: this.traceId, nodeId: this.nodeId },
        UpdateExpression:
          'SET #status = :status, finalResponse = :resp, endTime = :end, metadata = :meta',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': TRACE_STATUS.COMPLETED,
          ':resp': finalResponse,
          ':end': endTime,
          ':meta': metadata ?? {},
        },
      })
    );

    // Emit metrics for trace completion
    if (this.agentId) {
      try {
        const { emitMetrics } = await import('../metrics/metrics');
        await emitMetrics([
          METRICS.agentInvoked(this.agentId),
          METRICS.agentDuration(this.agentId, durationMs),
        ]);
      } catch (e) {
        logger.debug('Failed to emit trace completion metrics:', e);
      }
    }

    // Mark the summary as completed as well (root-only) when enabled.
    const summariesEnabledEnd = process.env.TRACE_SUMMARIES_ENABLED === 'true';
    if (summariesEnabledEnd && this.nodeId === 'root') {
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.getTableName(),
            Key: { traceId: this.traceId, nodeId: '__summary__' },
            UpdateExpression: 'SET #status = :status, #ts = :ts, finalResponse = :resp',
            ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
            ExpressionAttributeValues: {
              ':status': TRACE_STATUS.COMPLETED,
              ':ts': endTime,
              ':resp': finalResponse,
            },
          })
        );
      } catch (e) {
        logger.warn(`Failed to update trace summary on end for ${this.traceId}:`, e);
      }
    }
  }

  /**
   * Ends the trace node with a failure status.
   * Sh5: Critical for preventing 'Ghost Traces' when an agent crashes.
   *
   * @param reason - The failure reason or error message.
   * @param metadata - Additional failure context.
   */
  async failTrace(reason: string, metadata?: Record<string, unknown>): Promise<void> {
    const finalMetadata = { ...metadata, failureReason: reason };
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: { traceId: this.traceId, nodeId: this.nodeId },
        UpdateExpression:
          'SET #status = :status, failureReason = :reason, endTime = :end, metadata = :meta',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': TRACE_STATUS.FAILED,
          ':reason': reason,
          ':end': endTime,
          ':meta': finalMetadata,
        },
      })
    );

    // Emit metrics for trace failure
    if (this.agentId) {
      try {
        const { emitMetrics } = await import('../metrics/metrics');
        await emitMetrics([
          METRICS.agentInvoked(this.agentId),
          METRICS.agentDuration(this.agentId, durationMs),
          METRICS.toolExecuted('trace', false),
        ]);
      } catch (e) {
        logger.debug('Failed to emit trace failure metrics:', e);
      }
    }

    // Mark the summary as failed as well
    const summariesEnabledFail = process.env.TRACE_SUMMARIES_ENABLED === 'true';
    if (summariesEnabledFail && this.nodeId === 'root') {
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.getTableName(),
            Key: { traceId: this.traceId, nodeId: '__summary__' },
            UpdateExpression: 'SET #status = :status, #ts = :ts, failureReason = :reason',
            ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
            ExpressionAttributeValues: {
              ':status': TRACE_STATUS.FAILED,
              ':ts': endTime,
              ':reason': reason,
            },
          })
        );
      } catch (e) {
        logger.warn(`Failed to update trace summary on failure for ${this.traceId}:`, e);
      }
    }
  }

  /**
   * Returns the current trace ID.
   *
   * @returns The trace ID string.
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * Returns the current node ID.
   *
   * @returns The node ID string.
   */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * Returns the parent node ID.
   *
   * @returns The parent node ID string or undefined.
   */
  getParentId(): string | undefined {
    return this.parentId;
  }

  /**
   * Retrieves all nodes belonging to a specific traceId.
   *
   * @param traceId - The trace ID to retrieve.
   * @returns A promise resolving to an array of trace nodes.
   */
  static async getTrace(traceId: string): Promise<Trace[]> {
    const response = await getDocClient().send(
      new QueryCommand({
        TableName: (Resource as unknown as SSTResource).TraceTable.name,
        KeyConditionExpression: 'traceId = :tid',
        ExpressionAttributeValues: { ':tid': traceId },
      })
    );
    return (response.Items as Trace[]) ?? [];
  }
}
