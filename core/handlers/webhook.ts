import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { TraceSource, AgentType, Attachment } from '../lib/types/agent';
import { TelegramAdapter } from '../adapters/input/telegram';

/**
 * Main entry point for webhooks (Telegram and other platforms).
 * Processes inbound messages, handles media, and delegates to the SuperClaw.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  logger.info('[WEBHOOK] Start | Event:', event.body?.substring(0, 100));

  // --- SMART WARM-UP (Human-Activity Based) ---
  const warmUpFunctions = process.env.WARM_UP_FUNCTIONS;
  const mcpServerArns = process.env.MCP_SERVER_ARNS;
  if (warmUpFunctions || mcpServerArns) {
    try {
      const { WarmupManager } = await import('../lib/warmup');
      const agentArns = warmUpFunctions ? JSON.parse(warmUpFunctions) : {};
      const serverArns = mcpServerArns ? JSON.parse(mcpServerArns) : {};

      const warmupManager = new WarmupManager({
        servers: serverArns,
        agents: agentArns,
        ttlSeconds: 900, // 15 minutes
      });

      warmupManager
        .smartWarmup({
          servers: Object.keys(serverArns),
          agents: Object.keys(agentArns),
          intent: 'webhook-received',
          warmedBy: 'webhook',
        })
        .catch((err) => logger.warn('[WEBHOOK] Smart warmup error:', err));
    } catch (err) {
      logger.warn('[WEBHOOK] Failed to initiate smart warmup:', err);
    }
  }

  // Determine source and initialize appropriate adapter
  const telegramAdapter = new TelegramAdapter();
  let inbound;

  try {
    if (!event.body) throw new Error('Missing event body');
    // For now, default to Telegram as it's the primary channel
    // In the future, this can be routed based on headers or path
    inbound = telegramAdapter.parse(JSON.parse(event.body));
  } catch (error) {
    logger.error('[WEBHOOK] Failed to parse inbound message:', error);
    return { statusCode: 400, body: 'Invalid message format' };
  }

  const { chatId, userId, sessionId, text } = {
    chatId: inbound.userId,
    userId: inbound.userId,
    sessionId: inbound.sessionId,
    text: inbound.text,
  };

  if (!text && inbound.attachments.length === 0 && !inbound.metadata.rawMessage) {
    logger.info('[WEBHOOK] No actionable content');
    return { statusCode: 200, body: 'OK' };
  }

  logger.info(
    `[WEBHOOK] Source: ${inbound.source} | User: ${userId} | Text: ${text.substring(0, 50)}`
  );

  // Process Media/Attachments via Adapter
  const messageWithMedia = await telegramAdapter.processMedia(inbound);
  const attachments = messageWithMedia.attachments as Attachment[];

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
  const canProcess = await sessionStateManager.acquireProcessing(chatId, lambdaRequestId);

  if (!canProcess) {
    logger.info(`[WEBHOOK] Session ${chatId} busy, queuing message...`);
    await sessionStateManager.addPendingMessage(chatId, text, attachments);
    return { statusCode: 200, body: 'Message queued for processing' };
  }

  try {
    // 3. Process message via Agent
    logger.info('[WEBHOOK] Loading config...');
    const config = await AgentRegistry.getAgentConfig(AgentType.SUPERCLAW);
    if (!config) throw new Error('Main agent config missing');

    const { profile, cleanText } = SuperClaw.parseCommand(text);

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
        sessionStateManager,
        ignoreHandoff: true,
      }
    );
    logger.info('[WEBHOOK] Process complete.');

    // 4. Send response back
    await sendOutboundMessage(
      'webhook.handler',
      chatId,
      responseText,
      undefined,
      undefined,
      'SuperClaw',
      resultAttachments
    );
  } catch (err) {
    logger.error('[WEBHOOK] Execution Error:', err);
    throw err;
  } finally {
    // 5. Release processing flag
    await sessionStateManager.releaseProcessing(chatId);
  }

  return { statusCode: 200, body: 'OK' };
};
