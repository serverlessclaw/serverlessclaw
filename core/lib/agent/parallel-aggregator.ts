import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/system';
import { AggregatedResult } from './schema';
import { logger } from '../logger';
import { TIME } from '../constants';

const defaultClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(defaultClient);
const typedResource = Resource as unknown as SSTResource;

const PARALLEL_PREFIX = 'PARALLEL#';

/**
 * Manages aggregation of parallel agent task results using DynamoDB.
 */
export class ParallelAggregator {
  private tableName: string = typedResource.MemoryTable.name;

  /**
   * Initializes a new parallel dispatch tracking record.
   */
  async init(
    userId: string,
    traceId: string,
    taskCount: number,
    initiatorId: string,
    sessionId?: string
  ): Promise<void> {
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + TIME.SECONDS_IN_HOUR;

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          userId: `USER#${userId}`,
          timestamp: `${PARALLEL_PREFIX}${traceId}`,
          taskCount,
          completedCount: 0,
          results: [],
          initiatorId,
          sessionId,
          expiresAt,
          status: 'pending',
          createdAt: Date.now(),
        },
      })
    );
  }

  /**
   * Adds a result to an existing parallel dispatch record.
   * Returns the updated record if it's now complete, null otherwise.
   */
  async addResult(
    userId: string,
    traceId: string,
    result: AggregatedResult
  ): Promise<{
    isComplete: boolean;
    taskCount: number;
    results: AggregatedResult[];
    initiatorId: string;
    sessionId?: string;
  } | null> {
    try {
      const response = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: `USER#${userId}`,
            timestamp: `${PARALLEL_PREFIX}${traceId}`,
          },
          UpdateExpression:
            'SET results = list_append(if_not_exists(results, :empty_list), :new_result), completedCount = completedCount + :one',
          ConditionExpression: 'attribute_exists(userId)',
          ExpressionAttributeValues: {
            ':new_result': [result],
            ':empty_list': [],
            ':one': 1,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const updated = response.Attributes;
      if (!updated) return null;

      const isComplete = updated.completedCount >= updated.taskCount;

      return {
        isComplete,
        taskCount: updated.taskCount,
        results: updated.results,
        initiatorId: updated.initiatorId,
        sessionId: updated.sessionId,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        // Not a parallel task or record expired
        return null;
      }
      logger.error('Error adding parallel result:', error);
      throw error;
    }
  }

  /**
   * Retrieves the current state of a parallel dispatch.
   */
  async getState(userId: string, traceId: string) {
    const response = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          userId: `USER#${userId}`,
          timestamp: `${PARALLEL_PREFIX}${traceId}`,
        },
      })
    );
    return response.Item;
  }
}

export const aggregator = new ParallelAggregator();
