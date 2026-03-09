import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Health probe Lambda, called by check_health tool after a deployment.
 * Returns 200 OK if the system and DynamoDB state are intact.
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    // Verify DynamoDB is accessible (core state layer)
    const { Item } = await db.send(
      new GetCommand({
        TableName: Resource.MemoryTable.name,
        Key: {
          userId: 'SYSTEM#DEPLOY_STATS',
          timestamp: 0,
        },
      })
    );

    const today = new Date().toISOString().split('T')[0];
    const deployCount = Item?.lastReset === today ? (Item?.count ?? 0) : 0;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        deployCountToday: deployCount,
        message: 'System healthy.',
      }),
    };
  } catch (error) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
