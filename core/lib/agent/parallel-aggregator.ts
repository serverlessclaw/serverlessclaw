import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/system';
import type { DAGExecutionState } from '../types/dag';
import { AggregatedResult } from './schema';
import { logger } from '../logger';
import { TIME } from '../constants';

const defaultClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const typedResource = Resource as unknown as SSTResource;

const PARALLEL_PREFIX = 'PARALLEL#';
const SHARD_PREFIX = 'PARALLEL_SHARD#';

/**
 * DynamoDB item size limit is 400KB.
 * We use 300KB as a safe threshold for sharding to account for metadata and overhead.
 */
const ITEM_SIZE_THRESHOLD_BYTES = 300 * 1024;

/**
 * Manages aggregation of parallel agent task results using DynamoDB.
 * Supports sharding for large parallel dispatches exceeding 400KB.
 */
export class ParallelAggregator {
  private tableName: string = typedResource?.MemoryTable?.name ?? 'MemoryTable';

  /**
   * Estimates the byte size of a result object when serialized to JSON.
   */
  private estimateSize(obj: unknown): number {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
  }

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
          results_shards: [],
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
   * Handles automatic sharding if the main item size threshold is reached.
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
    const key = `${PARALLEL_PREFIX}${userId}#${traceId}`;

    try {
      // 1. Get current state to check size
      const current = await this.getState(userId, traceId);
      if (!current || current.status !== 'pending') return null;

      // Check if this task ID was already processed (idempotency)
      if (current.results_ids.includes(result.taskId)) {
        logger.info(`Result for task ${result.taskId} already recorded in trace ${traceId}`);
        return {
          isComplete: current.completedCount >= current.taskCount,
          taskCount: current.taskCount,
          results: current.results,
          initiatorId: current.initiatorId,
          sessionId: current.sessionId,
          status: current.status,
          aggregationType: current.aggregationType,
          aggregationPrompt: current.aggregationPrompt,
        };
      }

      const currentSize = this.estimateSize(current);
      const resultSize = this.estimateSize(result);

      // 2. Decide: Main item or Shard?
      if (currentSize + resultSize < ITEM_SIZE_THRESHOLD_BYTES) {
        // Standard atomic update to the main item
        const response = await docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression:
              'SET results = list_append(if_not_exists(results, :empty_list), :new_result), ' +
              'completedCount = completedCount + :one, ' +
              'results_ids = list_append(if_not_exists(results_ids, :empty_list), :new_id)',
            ConditionExpression:
              'attribute_exists(userId) AND #status = :pending AND NOT contains(results_ids, :taskId)',
            ExpressionAttributeNames: { '#status': 'status' },
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

        const results = await this.mergeShardedResults(updated.results, updated.results_shards);

        return {
          isComplete: updated.completedCount >= updated.taskCount,
          taskCount: updated.taskCount,
          results,
          initiatorId: updated.initiatorId,
          sessionId: updated.sessionId,
          status: updated.status,
          aggregationType: updated.aggregationType,
          aggregationPrompt: updated.aggregationPrompt,
        };
      } else {
        // 3. Sharding flow: Create a shard record and update main record metadata
        logger.info(
          `Trace ${traceId} size threshold reached (${currentSize} bytes). Sharding result for ${result.taskId}.`
        );

        const shardPk = `${SHARD_PREFIX}${userId}#${traceId}#${Date.now()}`;
        const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + TIME.SECONDS_IN_HOUR;

        // Atomic update to main item to register the shard and increment count
        // Note: we don't put the result in 'results' list here to save space
        const response = await docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression:
              'SET results_shards = list_append(if_not_exists(results_shards, :empty_list), :new_shard), ' +
              'completedCount = completedCount + :one, ' +
              'results_ids = list_append(if_not_exists(results_ids, :empty_list), :new_id)',
            ConditionExpression:
              'attribute_exists(userId) AND #status = :pending AND NOT contains(results_ids, :taskId)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':new_shard': [shardPk],
              ':new_id': [result.taskId],
              ':empty_list': [],
              ':one': 1,
              ':pending': 'pending',
              ':taskId': result.taskId,
            },
            ReturnValues: 'ALL_NEW',
          })
        );

        // Create the shard item
        await docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              userId: shardPk,
              timestamp: 0,
              type: 'PARALLEL_SHARD',
              traceId,
              result,
              expiresAt,
            },
          })
        );

        const updated = response.Attributes;
        if (!updated) return null;

        const results = await this.mergeShardedResults(updated.results, updated.results_shards);

        return {
          isComplete: updated.completedCount >= updated.taskCount,
          taskCount: updated.taskCount,
          results,
          initiatorId: updated.initiatorId,
          sessionId: updated.sessionId,
          status: updated.status,
          aggregationType: updated.aggregationType,
          aggregationPrompt: updated.aggregationPrompt,
        };
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return null;
      }
      logger.error('Error adding parallel result:', error);
      throw error;
    }
  }

  /**
   * Helper to merge results from the main item and all associated shards.
   */
  private async mergeShardedResults(
    mainResults: AggregatedResult[],
    shardPks: string[]
  ): Promise<AggregatedResult[]> {
    if (!shardPks || shardPks.length === 0) return mainResults;

    const results = [...mainResults];

    // Batch get shards (max 100 per call, though unlikely to have 100 shards)
    const shards = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: shardPks.map((pk) => ({ userId: pk, timestamp: 0 })),
          },
        },
      })
    );

    const shardItems = shards.Responses?.[this.tableName] || [];
    for (const item of shardItems) {
      if (item.result) results.push(item.result as AggregatedResult);
    }

    return results;
  }

  /**
   * Atomically marks a parallel dispatch as completed.
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
          ConditionExpression: isTimeout
            ? 'attribute_exists(userId) AND #status = :pending AND completedCount < taskCount'
            : 'attribute_exists(userId) AND #status = :pending AND completedCount >= taskCount',
          ExpressionAttributeNames: { '#status': 'status' },
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
        return false;
      }
      throw error;
    }
  }

  /**
   * Retrieves the current state of a parallel dispatch, including all sharded results.
   */
  async getState(userId: string, traceId: string) {
    const response = await docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          userId: `${PARALLEL_PREFIX}${userId}#${traceId}`,
          timestamp: 0,
        },
        ConsistentRead: true,
      })
    );

    const item = response.Item;
    if (!item) return undefined;

    const results = await this.mergeShardedResults(item.results || [], item.results_shards || []);

    return {
      userId: item.userId,
      timestamp: item.timestamp,
      taskCount: item.taskCount,
      completedCount: item.completedCount,
      results,
      initiatorId: item.initiatorId,
      sessionId: item.sessionId,
      expiresAt: item.expiresAt,
      status: item.status,
      createdAt: item.createdAt,
      taskMapping: item.taskMapping || [],
      results_ids: item.results_ids || [],
      aggregationType: item.aggregationType,
      aggregationPrompt: item.aggregationPrompt,
      metadata: item.metadata || {},
      version: item.version,
    };
  }

  /**
   * Atomically updates the DAG execution state.
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
   * Updates progress for a specific task.
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
          ExpressionAttributeNames: { '#taskId': taskId },
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
