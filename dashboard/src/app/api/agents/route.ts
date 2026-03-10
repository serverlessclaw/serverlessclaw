import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { NextResponse } from 'next/server';

import { AgentRegistry } from '@claw/core/lib/registry.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function GET() {
  try {
    const configs = await AgentRegistry.getAllConfigs();
    return NextResponse.json(configs);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    await docClient.send(
      new PutCommand({
        TableName: (Resource as any).ConfigTable.name,
        Item: { 
          key: 'agents_config', 
          value: body 
        },
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update agents' }, { status: 500 });
  }
}
