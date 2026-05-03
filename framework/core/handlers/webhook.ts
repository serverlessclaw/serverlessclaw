import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { isE2ETest } from '../lib/utils/agent-helpers';
import {
  TraceSource,
  AgentType,
  Attachment,
  isValidAttachment,
  GapStatus,
} from '../lib/types/agent';
import { InputAdapter } from '../adapters/input/types';
import { bootstrap } from '../lib/bootstrap';

/**
 * Main entry point for webhooks (Telegram and other platforms).
 * Processes inbound messages, handles media, and delegates to the SuperClaw.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  await bootstrap();
  logger.info('[WEBHOOK] Start | Event:', event.body?.substring(0, 100));

  // 1. Identify Source and Initialize Adapter
  const source = identifySource(event);
  logger.info(`[WEBHOOK] Identified source: ${source}`);

  let adapter: InputAdapter;
  switch (source) {
    case 'github': {
      const { GitHubAdapter } = await import('../adapters/input');
      adapter = new GitHubAdapter() as unknown as InputAdapter;
      break;
    }
    case 'slack': {
      const { SlackAdapter } = await import('../adapters/input/slack');
      adapter = new SlackAdapter();
      break;
    }
    case 'jira': {
      const { JiraAdapter } = await import('../adapters/input/jira');
      adapter = new JiraAdapter();
      break;
    }
    case 'unknown': {
      logger.warn(`[WEBHOOK] Explicitly unknown source detected. Returning 400.`);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Unknown webhook source',
          message: 'Could not identify the webhook source from headers or body',
          availableSources: ['github', 'slack', 'jira', 'telegram'],
        }),
      };
    }
    case 'telegram':
    default: {
      const { TelegramAdapter } = await import('../adapters/input/telegram');
      adapter = new TelegramAdapter();
      break;
    }
  }

  let inbound;
  try {
    if (!event.body) throw new Error('Missing event body');
    // Pass the entire event object so adapters can access headers/query params for verification
    inbound = adapter.parse(event);

    // Handle Slack URL verification challenge immediately
    if (source === 'slack' && inbound.metadata.isChallenge) {
      logger.info('[WEBHOOK] Responding to Slack URL verification challenge');
      return { statusCode: 200, body: inbound.text };
    }
  } catch (error) {
    logger.error(`[WEBHOOK] Failed to parse ${source} message:`, error);
    return { statusCode: 400, body: `Invalid ${source} message format` };
  }

  const { userId, sessionId, workspaceId, teamId, staffId, text } = inbound;

  const chatId = sessionId; // P1 Fix: Use sessionId for session-level locking and context

  // --- GENERALIZED SMART WARM-UP (Activity Based) ---
  const warmUpFunctions = process.env.WARM_UP_FUNCTIONS;
  if (warmUpFunctions && text) {
    const { WarmupManager } = await import('../lib/warmup');
    const { SessionStateManager } = await import('../lib/session/session-state');
    const bucketArns = JSON.parse(warmUpFunctions) as Record<string, string>;

    const warmupManager = new WarmupManager({
      servers: process.env.MCP_SERVER_ARNS ? JSON.parse(process.env.MCP_SERVER_ARNS) : {},
      agents: bucketArns,
      ttlSeconds: 900,
    });

    const sessionManager = new SessionStateManager();
    sessionManager
      .getState(chatId)
      .then((state) => warmupManager.identifyTargets(text, state))
      .then((targets) => {
        logger.info(`[WEBHOOK] Identified warmup targets for ${chatId}: ${targets.join(', ')}`);
        return warmupManager.smartWarmup({
          agents: targets,
          intent: 'webhook-arrival',
          warmedBy: 'webhook',
          workspaceId,
        });
      })
      .catch((err) => logger.warn('[WEBHOOK] Smart warmup background error:', err));
  }

  if (!text && inbound.attachments.length === 0 && !inbound.metadata.rawMessage) {
    logger.info('[WEBHOOK] No actionable content');
    return { statusCode: 200, body: 'OK' };
  }

  logger.info(
    `[WEBHOOK] Source: ${inbound.source} | User: ${userId} | Text: ${text.substring(0, 50)}`
  );

  try {
    if (!isE2ETest()) {
      const { getIdentityManager } = await import('../lib/session/identity');
      const identityManager = await getIdentityManager();
      const authResult = await identityManager.authenticate(
        userId,
        source === 'dashboard' || source === 'api_key' ? source : 'telegram', // Fallback for unsupported sources
        { workspaceId, teamId, staffId }
      );

      if (!authResult.success) {
        logger.warn(`[WEBHOOK] Authentication failed for ${userId}: ${authResult.error}`);
        return { statusCode: 403, body: `Forbidden: ${authResult.error}` };
      }
    }
  } catch (authError) {
    logger.error(`[WEBHOOK] Identity verification error:`, authError);
    return { statusCode: 403, body: 'Forbidden: Identity verification failed' };
  }

  // Process Media/Attachments via Adapter
  const attachments: Attachment[] = [];
  if (adapter.processMedia) {
    const messageWithMedia = await adapter.processMedia(inbound);
    const rawAttachments = messageWithMedia.attachments ?? [];
    if (Array.isArray(rawAttachments)) {
      for (const rawAtt of rawAttachments) {
        if (isValidAttachment(rawAtt)) attachments.push(rawAtt as Attachment);
        else logger.warn('[WEBHOOK] Dropping invalid attachment from adapter');
      }
    }
  }

  // Lazy load dependencies to reduce initial context budget
  logger.info('[WEBHOOK] Lazy loading deps...');
  const [
    { DynamoMemory },
    { ProviderManager },
    { SessionStateManager },
    { getAgentTools },
    { SuperClaw },
    { AgentRegistry },
    { requestHandoff },
  ] = await Promise.all([
    import('../lib/memory'),
    import('../lib/providers/index'),
    import('../lib/session/session-state'),
    import('../tools/index'),
    import('../agents/superclaw'),
    import('../lib/registry'),
    import('../lib/handoff'),
  ]);

  const memory = new DynamoMemory();
  const provider = new ProviderManager();
  const sessionStateManager = new SessionStateManager();
  const lambdaRequestId = context.awsRequestId;

  // Request Handoff (Phase B3: Real-time Shared Awareness)
  await requestHandoff(chatId);

  // 1. Try to acquire processing flag
  logger.info('[WEBHOOK] Checking processing status...');
  const canProcess = await sessionStateManager.acquireProcessing(chatId, lambdaRequestId, {
    workspaceId,
    teamId,
    staffId,
  });

  if (!canProcess) {
    logger.info(`[WEBHOOK] Session ${chatId} busy, queuing message...`);
    await sessionStateManager.addPendingMessage(chatId, text, attachments, {
      workspaceId,
      teamId,
      staffId,
    });
    return { statusCode: 200, body: 'Message queued for processing' };
  }

  try {
    // 3. Process message via Agent
    logger.info('[WEBHOOK] Loading config...');
    const config = await AgentRegistry.getAgentConfig(AgentType.SUPERCLAW);
    if (!config) throw new Error('Main agent config missing');

    const { profile, cleanText, command } = SuperClaw.parseCommand(text);

    // Handle approval responses for HITL mode
    if (command === 'APPROVE' || command === 'REJECT') {
      logger.info(`[WEBHOOK] Processing ${command} command for user ${userId}`);
      try {
        const { DynamoMemory } = await import('../lib/memory');
        const memory = new DynamoMemory();

        // Find gaps in PENDING_APPROVAL status for this user
        const pendingGaps = await memory.getAllGaps(GapStatus.PENDING_APPROVAL);
        // Filter by sessionId/requestingUserId in metadata since gaps store these in metadata
        const userGaps = pendingGaps.filter(
          (g) => g.metadata.sessionId === sessionId || g.metadata.requestingUserId === userId
        );

        if (userGaps.length === 0) {
          await sendOutboundMessage(
            'webhook.handler',
            userId,
            'No pending approvals found.',
            undefined,
            sessionId,
            'SuperClaw',
            undefined,
            undefined,
            undefined,
            workspaceId,
            teamId,
            staffId
          );
        } else {
          const gapIds = userGaps.map((g) => g.id);
          if (command === 'APPROVE') {
            // Transition to DONE
            for (const gapId of gapIds) {
              const lockAcquired = await memory.acquireGapLock(gapId, 'webhook.handler');
              if (lockAcquired) {
                try {
                  await memory.updateGapStatus(gapId, GapStatus.DONE);
                } finally {
                  await memory.releaseGapLock(gapId, 'webhook.handler');
                }
              }
            }
            await sendOutboundMessage(
              'webhook.handler',
              userId,
              `✅ **Approved!** Gaps ${gapIds.join(', ')} have been closed.`,
              undefined,
              sessionId,
              'SuperClaw',
              undefined,
              undefined,
              undefined,
              workspaceId,
              teamId,
              staffId
            );
          } else {
            // REJECT - transition back to OPEN for revision
            for (const gapId of gapIds) {
              const lockAcquired = await memory.acquireGapLock(gapId, 'webhook.handler');
              if (lockAcquired) {
                try {
                  await memory.updateGapStatus(gapId, GapStatus.OPEN);
                } finally {
                  await memory.releaseGapLock(gapId, 'webhook.handler');
                }
              }
            }
            await sendOutboundMessage(
              'webhook.handler',
              userId,
              `❌ **Rejected.** Gaps ${gapIds.join(', ')} have been reopened for revision.`,
              undefined,
              sessionId,
              'SuperClaw',
              undefined,
              undefined,
              undefined,
              workspaceId,
              teamId,
              staffId
            );
          }
        }
      } catch (err) {
        logger.error('[WEBHOOK] Error processing approval:', err);
        await sendOutboundMessage(
          'webhook.handler',
          userId,
          'Error processing your response. Please try again.',
          undefined,
          sessionId,
          'SuperClaw',
          undefined,
          undefined,
          undefined,
          workspaceId,
          teamId,
          staffId
        );
      }
      return { statusCode: 200, body: 'OK' };
    }

    logger.info('[WEBHOOK] Loading tools...');
    const agentTools = await getAgentTools(AgentType.SUPERCLAW);

    const agent = new SuperClaw(memory, provider, agentTools, config);
    logger.info('[WEBHOOK] Starting agent process...');
    const { responseText, attachments: resultAttachments } = await agent.process(
      chatId,
      cleanText,
      {
        profile,
        context,
        source: inbound.source === 'telegram' ? TraceSource.TELEGRAM : TraceSource.API,
        attachments,
        sessionId,
        workspaceId,
        teamId,
        staffId,
        sessionStateManager,
        ignoreHandoff: true,
      }
    );
    logger.info('[WEBHOOK] Process complete.');

    // 4. Send response back
    await sendOutboundMessage(
      'webhook.handler',
      userId,
      responseText,
      undefined,
      sessionId,
      'SuperClaw',
      resultAttachments,
      undefined,
      undefined,
      workspaceId,
      teamId,
      staffId
    );
  } catch (err) {
    logger.error('[WEBHOOK] Execution Error:', err);
    throw err;
  } finally {
    // 5. Release processing flag
    await sessionStateManager.releaseProcessing(chatId, lambdaRequestId, {
      workspaceId,
      teamId,
      staffId,
    });
  }

  return { statusCode: 200, body: 'OK' };
};

/**
 * Identifies the source of the webhook based on headers and body content.
 */
function identifySource(event: APIGatewayProxyEventV2): string {
  const headers = event.headers || {};
  const body = event.body ? JSON.parse(event.body) : {};

  // 1. GitHub: X-GitHub-Event header
  if (headers['x-github-event'] || headers['X-GitHub-Event']) {
    return 'github';
  }

  // 2. Slack: X-Slack-Signature header or challenge in body
  if (
    headers['x-slack-signature'] ||
    headers['X-Slack-Signature'] ||
    body.type === 'url_verification'
  ) {
    return 'slack';
  }

  // 3. Jira: X-Jira-Webhook-Secret or webhookEvent in body
  if (headers['x-jira-webhook-secret'] || headers['X-Jira-Webhook-Secret'] || body.webhookEvent) {
    return 'jira';
  }

  // 4. Telegram: update_id is standard in all Telegram webhooks
  if (body.update_id) {
    return 'telegram';
  }

  // Check if body is non-empty, default to telegram for compatibility
  if (Object.keys(body).length > 0) {
    return 'telegram';
  }

  return 'unknown';
}
