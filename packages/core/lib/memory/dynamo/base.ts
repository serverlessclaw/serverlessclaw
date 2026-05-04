import { BaseMemoryProvider } from '../base';
import { logger } from '../../logger';

/**
 * Base implementation for DynamoMemory providing core utility methods.
 */
export class DynamoMemoryBase extends BaseMemoryProvider {
  /**
   * LEGACY: Retrieves a raw configuration JSON from the memory table.
   */
  async getConfig(key: string): Promise<Record<string, unknown> | undefined> {
    logger.debug(`[DynamoMemory] LEGACY getConfig: ${key}`);
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { userId: key, timestamp: 0 },
      })
    );
    return response.Item as Record<string, unknown> | undefined;
  }
}
