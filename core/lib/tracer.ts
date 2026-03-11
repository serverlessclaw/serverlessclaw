import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from './types/index';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

export interface TraceStep {
  stepId: string;
  type: 'llm_call' | 'tool_call' | 'tool_result' | 'error';
  content: unknown;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Trace {
  traceId: string;
  userId: string;
  timestamp: number;
  status: string;
  initialContext: Record<string, unknown>;
  steps: TraceStep[];
  expiresAt: number;
  finalResponse?: string;
  endTime?: number;
  metadata?: Record<string, unknown>;
}

export class ClawTracer {
  private tableName = typedResource.TraceTable.name;
  private traceId: string;
  private userId: string;
  private startTime: number;

  constructor(userId: string, traceId?: string) {
    this.userId = userId;
    this.traceId = traceId || uuidv4();
    this.startTime = Date.now();
  }

  /**
   * Initializes a new trace in DynamoDB.
   *
   * @param initialContext - Initial context for the trace (e.g., user input).
   * @returns A promise that resolves to the trace ID.
   */
  async startTrace(initialContext: Record<string, unknown>): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days TTL

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          traceId: this.traceId,
          userId: this.userId,
          timestamp: this.startTime,
          status: 'started',
          initialContext,
          steps: [],
          expiresAt,
        },
      })
    );
    return this.traceId;
  }

  /**
   * Adds a step to the current trace.
   *
   * @param step - The step content and type.
   * @returns A promise that resolves when the step is added.
   */
  async addStep(step: Omit<TraceStep, 'stepId' | 'timestamp'>): Promise<void> {
    const fullStep: TraceStep = {
      ...step,
      stepId: uuidv4(),
      timestamp: Date.now(),
    };

    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { traceId: this.traceId, timestamp: this.startTime },
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
   * Ends the trace with a final response and optional metadata.
   *
   * @param finalResponse - The final response sent to the user.
   * @param metadata - Additional metadata for the trace.
   * @returns A promise that resolves when the trace is closed.
   */
  async endTrace(finalResponse: string, metadata?: Record<string, unknown>): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { traceId: this.traceId, timestamp: this.startTime },
        UpdateExpression:
          'SET #status = :status, finalResponse = :resp, endTime = :end, metadata = :meta',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':resp': finalResponse,
          ':end': Date.now(),
          ':meta': metadata || {},
        },
      })
    );
  }

  /**
   * Returns the current trace ID.
   *
   * @returns The trace ID.
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * Retrieves a full trace from DynamoDB.
   */
  static async getTrace(traceId: string): Promise<Trace | undefined> {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const response = await docClient.send(
      new QueryCommand({
        TableName: typedResource.TraceTable.name,
        KeyConditionExpression: 'traceId = :tid',
        ExpressionAttributeValues: { ':tid': traceId },
        Limit: 1,
      })
    );
    return response.Items?.[0] as Trace | undefined;
  }
}
