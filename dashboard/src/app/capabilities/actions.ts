'use server';

import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { revalidatePath } from 'next/cache';

export async function updateAgentTools(formData: FormData) {
  const agentId = formData.get('agentId') as string;
  const toolNames = formData.getAll('tools') as string[];

  try {
    const tableName = (Resource as any).ConfigTable?.name;
    if (!tableName) {
      return { error: 'ConfigTable name is missing from Resources' };
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        key: `${agentId}_tools`,
        value: toolNames
      }
    }));

    revalidatePath('/capabilities');
    return { success: true };
  } catch (e) {
    console.error('Error updating agent tools:', e);
    return { error: e instanceof Error ? e.message : 'Failed to update tools' };
  }
}

export async function deleteMCPServer(serverName: string) {
  try {
    const tableName = (Resource as any).ConfigTable?.name;
    if (!tableName) return { error: 'ConfigTable name is missing' };
    
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    // 1. Get current servers
    const { GetCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { Item } = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { key: 'mcp_servers' }
    }));

    const servers = Item?.value || {};
    if (servers[serverName]) {
      delete servers[serverName];
      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: { key: 'mcp_servers', value: servers }
      }));
    }

    revalidatePath('/capabilities');
    return { success: true };
  } catch (e) {
    console.error('Error deleting MCP server:', e);
    return { error: e instanceof Error ? e.message : 'Failed to delete MCP server' };
  }
}
