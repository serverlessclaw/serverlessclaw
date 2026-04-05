import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/system';
import type { DAGExecutionState } from '../types/dag';
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
    taskMapping?: Array<{ taskId: string; agentId: string }>,
    aggregationType?: 'summary' | 'agent_guided' | 'merge_patches',
    aggregationPrompt?: string,
    metadata?: Record<string, unknown>,
    initialQuery?: string
  ): Promise<void> {
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + TIME.SECONDS_IN_HOUR;

    await docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
          timestamp: 0,
          taskCount,
          completedCount: 0,
          results: [],
          initiatorId,
          sessionId,
          expiresAt,
          status: 'pending',
          createdAt: Date.now(),
          taskMapping: taskMapping ?? [],
          results_ids: [],
          aggregationType,
          aggregationPrompt,
          initialQuery,
          metadata: metadata ?? {},
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
    aggregationType?: 'summary' | 'agent_guided' | 'merge_patches';
    aggregationPrompt?: string;
  } | null> {
    try {
      const response = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
            timestamp: 0,
          },
          UpdateExpression:
            'SET results = list_append(if_not_exists(results, :empty_list), :new_result), ' +
            'completedCount = completedCount + :one, ' +
            'results_ids = list_append(if_not_exists(results_ids, :empty_list), :new_id)',
          ConditionExpression:
            'attribute_exists(userId) AND #status = :pending AND NOT contains(results_ids, :taskId)',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
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
        aggregationType: updated.aggregationType as
          | 'summary'
          | 'agent_guided'
          | 'merge_patches'
          | undefined,
        aggregationPrompt: updated.aggregationPrompt,
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
    status: 'success' | 'partial' | 'failed' | 'timed_out'
  ): Promise<boolean> {
    try {
      const isTimeout = status === 'timed_out';

      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
            timestamp: 0,
          },
          UpdateExpression: 'SET #status = :status, completedAt = :now',
          // If marking as completed by a worker, ensure it's actually complete.
          // If marking as timeout, ensure it's still pending.
          ConditionExpression: isTimeout
            ? 'attribute_exists(userId) AND #status = :pending AND completedCount < taskCount'
            : 'attribute_exists(userId) AND #status = :pending AND completedCount >= taskCount',
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
        return false; // Already completed, doesn't exist, or condition not met
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
          userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
          timestamp: 0,
        },
      })
    );
    return response.Item as
      | {
          userId: string;
          timestamp: number;
          taskCount: number;
          completedCount: number;
          results: AggregatedResult[];
          initiatorId: string;
          sessionId?: string;
          expiresAt: number;
          status: string;
          createdAt: number;
          taskMapping: Array<{ taskId: string; agentId: string }>;
          results_ids: string[];
          aggregationType?: 'summary' | 'agent_guided' | 'merge_patches';
          aggregationPrompt?: string;
          metadata?: Record<string, unknown>;
          version?: number;
        }
      | undefined;
  }

  /**
   * Atomically updates the DAG execution state using optimistic concurrency control.
   */
  async updateDagState(
    userId: string,
    traceId: string,
    dagState: DAGExecutionState,
    expectedVersion: number
  ): Promise<boolean> {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
            timestamp: 0,
          },
          UpdateExpression: 'SET metadata.dagState = :dagState, version = :nextVersion',
          ConditionExpression:
            'attribute_exists(userId) AND (attribute_not_exists(version) OR version = :expectedVersion)',
          ExpressionAttributeValues: {
            ':dagState': dagState,
            ':expectedVersion': expectedVersion,
            ':nextVersion': expectedVersion + 1,
          },
        })
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      logger.error('Error updating parallel dagState:', error);
      throw error;
    }
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
            userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
            timestamp: 0,
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
