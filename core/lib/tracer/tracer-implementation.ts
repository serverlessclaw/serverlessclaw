import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TraceSource } from '../types/agent';
import { v4 as uuidv4 } from 'uuid';
import { TRACE_STATUS, TIME } from '../constants';
import { logger } from '../logger';
import { filterPIIFromObject } from '../utils/pii';
import { getDocClient, getTraceTableName } from '../utils/ddb-client';
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
  private workspaceId?: string;
  private orgId?: string;
  private teamId?: string;
  private staffId?: string;
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
   * @param scope - Optional hierarchical scope for isolation.
   * @param docClient - Optional DynamoDB Document Client for dependency injection.
   */
  constructor(
    userId: string,
    source: TraceSource | string = TraceSource.UNKNOWN,
    traceId?: string,
    nodeId?: string,
    parentId?: string,
    agentId?: string,
    scope?: {
      workspaceId?: string;
      orgId?: string;
      teamId?: string;
      staffId?: string;
    },
    docClient?: DynamoDBDocumentClient
  ) {
    this.userId = userId;
    this.source = source;
    this.traceId = traceId ?? uuidv4();
    this.nodeId = nodeId ?? 'root';
    this.parentId = parentId;
    this.agentId = agentId;
    this.workspaceId = scope?.workspaceId;
    this.orgId = scope?.orgId;
    this.teamId = scope?.teamId;
    this.staffId = scope?.staffId;
    this.startTime = Date.now();
    this.docClient = docClient ?? getDocClient();
  }

  private getTableName(): string {
    return getTraceTableName() ?? 'TraceTable';
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
    options: { extra?: Record<string, unknown>; isNew?: boolean } = {}
  ): Promise<void> {
    const { extra = {}, isNew = false } = options;
    if (!(await this.isSummaryEnabled())) return;

    await this.bestEffort(async () => {
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
              workspaceId: this.workspaceId,
              orgId: this.orgId,
              teamId: this.teamId,
              staffId: this.staffId,
              ...extra,
            },
            ConditionExpression: 'attribute_not_exists(traceId)',
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
            ConditionExpression: 'attribute_exists(traceId)',
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
            workspaceId: this.workspaceId,
            orgId: this.orgId,
            teamId: this.teamId,
            staffId: this.staffId,
            timestamp: now,
            status: TRACE_STATUS.STARTED,
            initialContext,
            steps: [],
            expiresAt,
          },
          ConditionExpression: 'attribute_not_exists(traceId) AND attribute_not_exists(nodeId)',
        })
      );

      await this.updateSummary(TRACE_STATUS.STARTED, {
        extra: {
          title: initialContext?.title ?? initialContext?.message ?? null,
          expiresAt,
        },
        isNew: true,
      });
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
      {
        workspaceId: this.workspaceId,
        orgId: this.orgId,
        teamId: this.teamId,
        staffId: this.staffId,
      },
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
        ConditionExpression: 'attribute_exists(traceId)',
        ExpressionAttributeNames: { '#steps': 'steps' },
        ExpressionAttributeValues: {
          ':step': [fullStep],
          ':empty_list': [],
        },
      })
    );

    await this.updateSummary(TRACE_STATUS.STARTED, {
      extra: { lastStepType: step.type },
    });
  }

  /**
   * Adds multiple steps to the current trace node in a single atomic update.
   * Sh5/Parallelism: Prevents write contention and improves throughput for batch tool execution.
   *
   * @param steps - Array of step contents and types.
   */
  async batchAddSteps(steps: Omit<TraceStep, 'stepId' | 'timestamp'>[]): Promise<void> {
    if (steps.length === 0) return;

    const fullSteps: TraceStep[] = steps.map((s) =>
      filterPIIFromObject({
        ...s,
        stepId: uuidv4(),
        timestamp: Date.now(),
      })
    ) as TraceStep[];

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: { traceId: this.traceId, nodeId: this.nodeId },
        UpdateExpression: 'SET #steps = list_append(if_not_exists(#steps, :empty_list), :steps)',
        ConditionExpression: 'attribute_exists(traceId)',
        ExpressionAttributeNames: { '#steps': 'steps' },
        ExpressionAttributeValues: {
          ':steps': fullSteps,
          ':empty_list': [],
        },
      })
    );

    await this.updateSummary(TRACE_STATUS.STARTED, {
      extra: { lastStepType: steps[steps.length - 1].type },
    });
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
        ConditionExpression: 'attribute_exists(traceId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': TRACE_STATUS.COMPLETED,
          ':resp': finalResponse,
          ':end': endTime,
          ':meta': metadata ?? {},
        },
      })
    );

    await this.updateSummary(TRACE_STATUS.COMPLETED, {
      extra: { finalResponse },
    });
    await this.emitCompletionMetrics(endTime, { success: true });
  }

  /**
   * Internal helper to emit agent-level metrics on trace completion/failure.
   */
  private async emitCompletionMetrics(
    endTime: number,
    options: { success?: boolean } = {}
  ): Promise<void> {
    const { success = true } = options;
    if (!this.agentId) return;

    try {
      const durationMs = endTime - this.startTime;
      const { emitMetrics } = await import('../metrics/metrics');
      const scope = {
        workspaceId: this.workspaceId,
        orgId: this.orgId,
        teamId: this.teamId,
        staffId: this.staffId,
      };
      await emitMetrics([
        METRICS.agentInvoked(this.agentId, success, scope),
        METRICS.agentDuration(this.agentId, durationMs, scope),
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
        ConditionExpression: 'attribute_exists(traceId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': TRACE_STATUS.FAILED,
          ':reason': reason,
          ':end': endTime,
          ':meta': finalMetadata,
        },
      })
    );

    await this.emitCompletionMetrics(endTime, { success: false });

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
        workspaceId: this.workspaceId,
        orgId: this.orgId,
        teamId: this.teamId,
        staffId: this.staffId,
        source: this.source === TraceSource.DASHBOARD ? TraceSource.DASHBOARD : TraceSource.SYSTEM,
      });
    } catch (e) {
      logger.warn('[Tracer] Failed to emit immediate failure event:', e);
    }

    await this.updateSummary(TRACE_STATUS.FAILED, {
      extra: { failureReason: reason },
    });
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
   * Includes workspaceId verification for multi-tenant isolation.
   *
   * @param traceId - The trace ID to retrieve.
   * @param workspaceId - Optional workspaceId for isolation check.
   * @returns A promise resolving to an array of trace nodes.
   */
  static async getTrace(traceId: string, workspaceId?: string): Promise<Trace[]> {
    const response = await getDocClient().send(
      new QueryCommand({
        TableName: getTraceTableName(),
        KeyConditionExpression: 'traceId = :tid',
        FilterExpression: workspaceId ? 'workspaceId = :ws' : undefined,
        ExpressionAttributeValues: {
          ':tid': traceId,
          ...(workspaceId ? { ':ws': workspaceId } : {}),
        },
      })
    );

    const items = (response.Items as Trace[]) ?? [];

    if (workspaceId && items.length > 0) {
      // All nodes in a trace should share the same workspaceId
      // We check the summary node or the first available node
      return items.filter((item) => item.workspaceId === workspaceId);
    }

    return items;
  }

  /**
   * Periodically checks for signal drift using the ConsistencyProbe.
   * Leverages on-demand activity to avoid background timers.
   * Also supports immediate drift detection for critical events.
   *
   * @param immediate - If true, triggers drift detection immediately regardless of elapsed time
   */
  async detectDrift(options: { immediate?: boolean } = {}): Promise<void> {
    const { immediate = false } = options;
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
  private async bestEffort(fn: () => Promise<void>, label: string): Promise<void> {
    try {
      await fn();
    } catch (e) {
      logger.warn(`[Tracer] Best-effort ${label} failed for ${this.traceId}:`, e);
    }
  }
}
