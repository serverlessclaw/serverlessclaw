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
    sessionId?: string,
    taskMapping?: Array<{ taskId: string; agentId: string }>
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
          taskMapping: taskMapping ?? [],
          results_ids: new Set([]),
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
    status: string;
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
            'SET results = list_append(if_not_exists(results, :empty_list), :new_result), ' +
            'completedCount = completedCount + :one, ' +
            'results_ids = list_append(if_not_exists(results_ids, :empty_list), :new_id)',
          ConditionExpression:
            'attribute_exists(userId) AND status = :pending AND NOT contains(results_ids, :taskId)',
          ExpressionAttributeValues: {
            ':new_result': [result],
            ':new_id': [result.taskId],
            ':empty_list': [],
            ':one': 1,
            ':pending': 'pending',
            ':taskId': result.taskId,
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
        status: updated.status,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return null;
      }
      logger.error('Error adding parallel result:', error);
      throw error;
    }
  }

  /**
   * Atomically marks a parallel dispatch as completed with a specific status.
   * This prevents multiple handlers from emitting the completion event.
   */
  async markAsCompleted(
    userId: string,
    traceId: string,
    status: 'success' | 'partial' | 'failed' | 'timeout'
  ): Promise<boolean> {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: `USER#${userId}`,
            timestamp: `${PARALLEL_PREFIX}${traceId}`,
          },
          UpdateExpression: 'SET #status = :status, completedAt = :now',
          ConditionExpression: 'attribute_exists(userId) AND #status = :pending',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': status,
            ':pending': 'pending',
            ':now': Date.now(),
          },
        })
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false; // Already completed or doesn't exist
      }
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

  /**
   * Updates progress for a specific task in a parallel dispatch.
   */
  async updateProgress(
    userId: string,
    traceId: string,
    taskId: string,
    progressPercent: number,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' = 'in_progress'
  ): Promise<void> {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: `USER#${userId}`,
            timestamp: `${PARALLEL_PREFIX}${traceId}`,
          },
          UpdateExpression: `
            SET progress = if_not_exists(progress, :empty_map),
                progress.#taskId = :progress
          `,
          ExpressionAttributeNames: {
            '#taskId': taskId,
          },
          ExpressionAttributeValues: {
            ':progress': {
              status,
              progressPercent,
              lastUpdate: Date.now(),
            },
            ':empty_map': {},
          },
        })
      );
    } catch (error) {
      logger.error('Error updating parallel task progress:', error);
    }
  }
}

export const aggregator = new ParallelAggregator();
