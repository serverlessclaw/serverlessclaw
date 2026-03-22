import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { NextResponse } from 'next/server';
import { HTTP_STATUS, DYNAMO_KEYS } from '@/lib/constants';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * GET handler for agents configuration.
 * Retrieves all registered agent configurations from the registry.
 * 
 * @returns A promise that resolves to a NextResponse containing the agents configurations.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const configs = await AgentRegistry.getAllConfigs();
    return NextResponse.json(configs);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents', details: error instanceof Error ? error.message : String(error) }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * POST handler for agents configuration.
 * Updates the global agents configuration in DynamoDB.
 * 
 * @param request - The incoming NextRequest containing the new agents configuration.
 * @returns A promise that resolves to a NextResponse indicating success or failure.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const tableName = Resource.ConfigTable.name;
    if (!tableName) {
      return NextResponse.json(
        { error: 'ConfigTable name is missing from resources.' }, 
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }
    const body = await request.json();
    
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: { 
          key: DYNAMO_KEYS.AGENTS_CONFIG ?? 'agents_config', 
          value: body 
        },
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating agents config:', error);
    return NextResponse.json(
      { error: 'Failed to update agents', details: error instanceof Error ? error.message : String(error) }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
