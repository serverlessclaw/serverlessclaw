import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export interface TraceStep {
  stepId: string;
  type: 'llm_call' | 'tool_call' | 'tool_result' | 'error';
  content: unknown;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class ClawTracer {
  private tableName = Resource.TraceTable.name;
  private traceId: string;
  private userId: string;
  private startTime: number;

  constructor(userId: string, traceId?: string) {
    this.userId = userId;
    this.traceId = traceId || uuidv4();
    this.startTime = Date.now();
  }

  async startTrace(initialContext: Record<string, unknown>) {
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

  async addStep(step: Omit<TraceStep, 'stepId' | 'timestamp'>) {
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

  async endTrace(finalResponse: string, metadata?: Record<string, unknown>) {
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

  getTraceId() {
    return this.traceId;
  }
}
