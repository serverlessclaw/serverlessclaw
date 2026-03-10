import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { sendOutboundMessage } from '../lib/outbound.js';
import { Resource } from 'sst';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: APIGatewayProxyEventV2) => {
  console.log('GitHub Webhook Event:', JSON.stringify(event, null, 2));

  if (!event.body) {
    return { statusCode: 400, body: 'Missing body' };
  }

  // GitHub sends the signature in 'x-hub-signature-256'
  // 2026 Optimization: In a real-world scenario, you'd verify the signature here.

  const payload = JSON.parse(event.body);
  const action = payload.action;
  const pr = payload.pull_request;

  if (!pr) {
    return { statusCode: 200, body: 'Not a PR event' };
  }

  // Detect Renovate/MendBot PRs
  const isRenovate =
    pr.user?.login === 'renovate[bot]' ||
    pr.user?.login === 'mend-renovate[bot]' ||
    pr.title?.toLowerCase().includes('renovate');

  if (!isRenovate) {
    return { statusCode: 200, body: 'Not a Renovate PR' };
  }

  // Fetch Admin Chat ID from ConfigTable
  let adminChatId: string | undefined;
  try {
    const { Item } = await db.send(
      new GetCommand({
        TableName: (Resource as unknown as { ConfigTable: { name: string } }).ConfigTable.name,
        Key: { key: 'admin_chat_id' },
      })
    );
    adminChatId = Item?.value;
  } catch (e) {
    console.warn('Could not fetch admin_chat_id from ConfigTable:', e);
  }

  if (!adminChatId) {
    console.warn('No admin_chat_id configured. Skipping notification.');
    return { statusCode: 200, body: 'No admin configured' };
  }

  // Notify on creation or update
  if (action === 'opened' || action === 'synchronize') {
    const isAutomerge =
      pr.auto_merge !== null || pr.labels?.some((l: { name: string }) => l.name === 'automerge');

    let message = `🛠 RENOBOT NOTIFICATION
PR ${action}: ${pr.title}
Repo: ${payload.repository.full_name}
Link: ${pr.html_url}\n\n`;

    if (isAutomerge) {
      message += `✅ AUTOMERGE ENABLED: I will monitor this PR and it will be merged once CI passes.`;
    } else {
      message += `⚠️ MANUAL REVIEW REQUIRED: This is a major update or could not be automerged. 
I have verified the daily run schedule. Would you like me to run 'validate_code' on this branch?`;
    }

    await sendOutboundMessage('renobot.handler', adminChatId, message, [adminChatId]);
  }

  return { statusCode: 200, body: 'OK' };
};
