import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';

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
 *
 * @returns The table name string.
 */
export function getConfigTableName(): string {
  const resource = Resource as { ConfigTable?: { name?: string } };
  return resource.ConfigTable?.name ?? 'ConfigTable';
}
