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
      throw new Error('ConfigTable name is missing from Resources');
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
  } catch (e) {
    console.error('Error updating agent tools:', e);
  }
}
