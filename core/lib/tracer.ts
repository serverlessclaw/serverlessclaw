import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from './types/system';
import { TraceSource } from './types/agent';
import { v4 as uuidv4 } from 'uuid';
import { TRACE_STATUS, TIME } from './constants';
import { logger } from './logger';
import { filterPIIFromObject } from './utils/pii';
import type { TraceStep, Trace } from './tracer/types';

const defaultClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const typedResource = Resource as unknown as SSTResource;

/**
 * ClawTracer provides observability into an agent's internal reasoning process
 * by persisting steps and metadata to DynamoDB.
 */
export class ClawTracer {
  private tableName: string = typedResource.TraceTable.name;
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
    this.docClient = docClient ?? defaultDocClient;
  }

  /**
   * Initializes a new trace node in DynamoDB.
   *
   * @param initialContext - Initial context for the trace (e.g., user input).
   * @returns A promise that resolves to the trace ID.
   */
  async startTrace(initialContext: Record<string, unknown>): Promise<string> {
    const { AgentRegistry } = await import('./registry');
    const days = await AgentRegistry.getRetentionDays('TRACES_DAYS');
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + days * TIME.SECONDS_IN_DAY;

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
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
        TableName: this.tableName,
        Key: { traceId: this.traceId, nodeId: this.nodeId },
        UpdateExpression: 'SET #steps = list_append(if_not_exists(#steps, :empty_list), :step)',
        ExpressionAttributeNames: { '#steps': 'steps' },
        ExpressionAttributeValues: {
          ':step': [fullStep],
          ':empty_list': [],
        },
      })
    );
  }

  /**
   * Ends the trace node with a final response and optional metadata.
   *
   * @param finalResponse - The final response sent to the user.
   * @param metadata - Additional metadata for the trace.
   * @returns A promise that resolves when the trace is closed.
   */
  async endTrace(finalResponse: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { traceId: this.traceId, nodeId: this.nodeId },
        UpdateExpression:
          'SET #status = :status, finalResponse = :resp, endTime = :end, metadata = :meta',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': TRACE_STATUS.COMPLETED,
          ':resp': finalResponse,
          ':end': Date.now(),
          ':meta': metadata ?? {},
        },
      })
    );
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
    const response = await defaultDocClient.send(
      new QueryCommand({
        TableName: typedResource.TraceTable.name,
        KeyConditionExpression: 'traceId = :tid',
        ExpressionAttributeValues: { ':tid': traceId },
      })
    );
    return (response.Items as Trace[]) ?? [];
  }
}
