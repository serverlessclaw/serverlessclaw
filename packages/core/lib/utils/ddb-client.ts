import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { resolveSSTResourceValue } from './resource-helpers';

/**
 * Shared DynamoDB document client instance for tracing and other utilities.
 * Ensures consistent marshaling options and singleton behavior.
 */
let _docClient: DynamoDBDocumentClient | undefined;

/**
 * Gets the singleton DynamoDB document client.
 * Configured with removeUndefinedValues: true to handle optional fields gracefully.
 *
 * @returns The initialized DynamoDBDocumentClient.
 */
export function getDocClient(): DynamoDBDocumentClient {
  if (!_docClient) {
    const client = new DynamoDBClient({});
    _docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }
  return _docClient;
}

/**
 * Resets the document client instance.
 * Primarily used in unit tests to ensure a clean state between test cases.
 */
export function resetDocClient(): void {
  _docClient = undefined;
}

/**
 * Returns the name of the ConfigTable resource.
 * Respects CONFIG_TABLE_NAME environment variable.
 *
 * @returns The table name string or undefined if not resolved.
 */
export function getConfigTableName(): string | undefined {
  return resolveSSTResourceValue('ConfigTable', 'name', 'CONFIG_TABLE_NAME');
}

/**
 * Returns the name of the MemoryTable resource.
 * Respects MEMORY_TABLE_NAME environment variable.
 *
 * @returns The table name string or undefined if not resolved.
 */
export function getMemoryTableName(): string | undefined {
  return resolveSSTResourceValue('MemoryTable', 'name', 'MEMORY_TABLE_NAME');
}

/**
 * Returns the name of the TraceTable resource.
 * Respects TRACE_TABLE_NAME environment variable.
 *
 * @returns The table name string or undefined if not resolved.
 */
export function getTraceTableName(): string | undefined {
  return resolveSSTResourceValue('TraceTable', 'name', 'TRACE_TABLE_NAME');
}
