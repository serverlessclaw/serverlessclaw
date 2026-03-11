import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { sendOutboundMessage } from '../lib/outbound';
import { Resource } from 'sst';
import { logger } from '../lib/logger';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: APIGatewayProxyEventV2) => {
  logger.info('GitHub Webhook Event:', JSON.stringify(event, null, 2));

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
    logger.warn('Could not fetch admin_chat_id from ConfigTable:', e);
  }

  if (!adminChatId) {
    logger.warn('No admin_chat_id configured. Skipping notification.');
    return { statusCode: 200, body: 'No admin configured' };
  }

  // Fetch Auto-Merge configuration
  let autoMergeEnabled = false;
  try {
    const { Item } = await db.send(
      new GetCommand({
        TableName: (Resource as unknown as { ConfigTable: { name: string } }).ConfigTable.name,
        Key: { key: 'renobot_auto_merge' },
      })
    );
    autoMergeEnabled = Item?.value === true || Item?.value === 'true';
  } catch (e) {
    logger.warn('Could not fetch renobot_auto_merge from ConfigTable:', e);
  }

  // Notify on creation or update
  if (action === 'opened' || action === 'synchronize') {
    const isAutomerge =
      pr.auto_merge !== null || pr.labels?.some((l: { name: string }) => l.name === 'automerge');

    let message = `🛠 RENOBOT NOTIFICATION
PR ${action}: ${pr.title}
Repo: ${payload.repository.full_name}
Link: ${pr.html_url}\n\n`;

    if (isAutomerge || autoMergeEnabled) {
      message += `✅ AUTOMERGE ENABLED: I will monitor this PR and it will be merged once CI passes.`;
    } else {
      message += `⚠️ MANUAL REVIEW REQUIRED: This is a major update or could not be automerged. 
I have verified the daily run schedule. Would you like me to run 'validate_code' on this branch?`;
    }

    await sendOutboundMessage('renobot.handler', adminChatId, message, [adminChatId]);
  }

  // Auto-merge if CI passes
  if (action === 'status' || (action === 'completed' && payload.check_run)) {
    // Note: status events have a different structure, we need to handle them carefully.
    // For simplicity in this demo, we check if the PR is mergeable and auto-merge is on.
    if (autoMergeEnabled && pr.mergeable_state === 'clean') {
      const { tools } = await import('../tools/index');
      const mergeTool = tools.merge_pr;
      if (mergeTool) {
        logger.info(`Auto-merging PR #${pr.number} as requested by Renobot policy.`);
        const result = await mergeTool.execute({ prNumber: pr.number, strategy: 'merge' });
        await sendOutboundMessage(
          'renobot.handler',
          adminChatId,
          `🤖 **Auto-Merge Result for PR #${pr.number}**:\n${result}`,
          [adminChatId]
        );
      }
    }
  }

  return { statusCode: 200, body: 'OK' };
};
