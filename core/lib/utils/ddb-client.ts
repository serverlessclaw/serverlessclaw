import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/system';

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
 * @returns The table name string.
 */
export function getConfigTableName(): string {
  try {
    const resource = Resource as unknown as SSTResource;
    return process.env.CONFIG_TABLE_NAME || resource.ConfigTable?.name || 'ConfigTable';
  } catch {
    return process.env.CONFIG_TABLE_NAME || 'ConfigTable';
  }
}

/**
 * Returns the name of the MemoryTable resource.
 * Respects MEMORY_TABLE_NAME environment variable.
 *
 * @returns The table name string.
 */
export function getMemoryTableName(): string {
  try {
    const resource = Resource as unknown as SSTResource;
    return process.env.MEMORY_TABLE_NAME || resource.MemoryTable?.name || 'MemoryTable';
  } catch {
    return process.env.MEMORY_TABLE_NAME || 'MemoryTable';
  }
}

/**
 * Returns the name of the TraceTable resource.
 * Respects TRACE_TABLE_NAME environment variable.
 *
 * @returns The table name string.
 */
export function getTraceTableName(): string {
  try {
    const resource = Resource as unknown as SSTResource;
    return process.env.TRACE_TABLE_NAME || resource.TraceTable?.name || 'TraceTable';
  } catch {
    return process.env.TRACE_TABLE_NAME || 'TraceTable';
  }
}
