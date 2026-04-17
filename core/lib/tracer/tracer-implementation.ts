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
import { FlowController } from '../routing/flow-controller';
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
  private summariesEnabled: boolean | null = null;

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
   * lazy-load and cache summary enablement status to ensure consistency during the trace lifecycle.
   */
  private async isSummaryEnabled(): Promise<boolean> {
    if (this.summariesEnabled === null) {
      this.summariesEnabled =
        (await FlowController.areTraceSummariesEnabled()) && this.nodeId === 'root';
    }
    return this.summariesEnabled;
  }

  /**
   * Internal helper to update or create the trace summary item.
   */
  private async updateSummary(
    status: string,
    extra: Record<string, unknown> = {},
    isNew: boolean = false
  ): Promise<void> {
    if (!(await this.isSummaryEnabled())) return;

    await this.withRetry(async () => {
      if (isNew) {
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
              status,
              ...extra,
            },
          })
        );
      } else {
        const updateExprParts = ['#status = :status', '#ts = :ts'];
        const attrNames: Record<string, string> = { '#status': 'status', '#ts': 'timestamp' };
        const attrValues: Record<string, unknown> = { ':status': status, ':ts': Date.now() };

        Object.entries(extra).forEach(([key, val], i) => {
          const valKey = `:v${i}`;
          updateExprParts.push(`#k${i} = ${valKey}`);
          attrNames[`#k${i}`] = key;
          attrValues[valKey] = val;
        });

        await this.docClient.send(
          new UpdateCommand({
            TableName: this.getTableName(),
            Key: { traceId: this.traceId, nodeId: '__summary__' },
            UpdateExpression: `SET ${updateExprParts.join(', ')}`,
            ExpressionAttributeNames: attrNames,
            ExpressionAttributeValues: attrValues,
          })
        );
      }
    }, 'UpdateSummary');
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
    const now = Date.now();
    const expiresAt = Math.floor(now / TIME.MS_PER_SECOND) + days * TIME.SECONDS_IN_DAY;

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
            timestamp: now,
            status: TRACE_STATUS.STARTED,
            initialContext,
            steps: [],
            expiresAt,
          },
          ConditionExpression: 'attribute_not_exists(traceId) AND attribute_not_exists(nodeId)',
        })
      );

      await this.updateSummary(
        TRACE_STATUS.STARTED,
        {
          title: initialContext?.title ?? initialContext?.message ?? null,
          expiresAt,
        },
        true
      );
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

    await this.updateSummary(TRACE_STATUS.STARTED, { lastStepType: step.type });
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

    await this.updateSummary(TRACE_STATUS.COMPLETED, { finalResponse });
    await this.emitCompletionMetrics(endTime, true);
  }

  /**
   * Internal helper to emit agent-level metrics on trace completion/failure.
   */
  private async emitCompletionMetrics(endTime: number, success: boolean = true): Promise<void> {
    if (!this.agentId) return;

    try {
      const durationMs = endTime - this.startTime;
      const { emitMetrics } = await import('../metrics/metrics');
      await emitMetrics([
        METRICS.agentInvoked(this.agentId, success),
        METRICS.agentDuration(this.agentId, durationMs),
      ]);
    } catch (e) {
      logger.debug('Failed to emit trace completion metrics:', e);
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

    await this.emitCompletionMetrics(endTime, false);

    // Emit immediate failure event for monitoring to trigger real-time remediation
    try {
      const { emitEvent } = await import('../utils/bus');
      const { AgentType, EventType } = await import('../types/agent');
      await emitEvent(AgentType.RECOVERY, EventType.DASHBOARD_FAILURE_DETECTED, {
        userId: this.userId,
        traceId: this.traceId,
        agentId: this.agentId || 'unknown',
        task: 'System Operation',
        error: reason,
        metadata: finalMetadata,
        source: this.source === TraceSource.DASHBOARD ? TraceSource.DASHBOARD : TraceSource.SYSTEM,
      });
    } catch (e) {
      logger.warn('[Tracer] Failed to emit immediate failure event:', e);
    }

    await this.updateSummary(TRACE_STATUS.FAILED, { failureReason: reason });
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

  /**
   * Periodically checks for signal drift using the ConsistencyProbe.
   * Leverages on-demand activity to avoid background timers.
   * Also supports immediate drift detection for critical events.
   *
   * @param immediate - If true, triggers drift detection immediately regardless of elapsed time
   */
  async detectDrift(immediate: boolean = false): Promise<void> {
    if (!this.agentId) return;

    if (immediate) {
      await this.performDriftCheck();
      return;
    }

    // Check drift once every 5 minutes per execution node
    const DRIFT_CHECK_THRESHOLD = 300000;
    const now = Date.now();

    if (now - this.startTime > DRIFT_CHECK_THRESHOLD) {
      await this.performDriftCheck();
    }
  }

  private async performDriftCheck(): Promise<void> {
    try {
      const { ConsistencyProbe } = await import('../metrics/cognitive-metrics');
      await ConsistencyProbe.detectDrift(this.agentId!);
    } catch (e) {
      logger.debug('[Tracer] Drift detection failed:', e);
    }
  }

  /**
   * Generic retry wrapper for best-effort secondary operations.
   */
  private async withRetry(fn: () => Promise<void>, label: string): Promise<void> {
    try {
      await fn();
    } catch (e) {
      logger.warn(`[Tracer] Best-effort ${label} failed for ${this.traceId}:`, e);
    }
  }
}
