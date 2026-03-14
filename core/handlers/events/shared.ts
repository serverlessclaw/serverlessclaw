import { EventType, CompletionEvent, FailureEvent } from '../../lib/types/index';
import { sendOutboundMessage } from '../../lib/outbound';
import { logger } from '../../lib/logger';
import { SYSTEM, DYNAMO_KEYS } from '../../lib/constants';
import { ConfigManager } from '../../lib/registry/config';
import { emitEvent } from '../../lib/utils/bus';
import { Agent } from '../../lib/agent';
import { ProviderManager } from '../../lib/providers/index';
import { getAgentTools } from '../../tools/index';
import { DynamoMemory } from '../../lib/memory';
import { TraceSource, Attachment } from '../../lib/types/index';
import { Context } from 'aws-lambda';

const memory = new DynamoMemory();
const provider = new ProviderManager();

/**
 * Wake up the initiator agent when a delegated task or system event completes.
 */
export async function wakeupInitiator(
  userId: string,
  initiatorId: string | undefined,
  task: string,
  traceId: string | undefined,
  sessionId: string | undefined,
  depth: number = 0
): Promise<void> {
  if (!initiatorId || !task) return;

  const initiatorAgentId = initiatorId.endsWith('.agent')
    ? initiatorId.replace('.agent', '')
    : initiatorId;

  await emitEvent('events.handler', EventType.CONTINUATION_TASK, {
    userId,
    agentId: initiatorAgentId,
    task,
    traceId,
    initiatorId,
    sessionId,
    depth: depth + 1,
  });
}

/**
 * Get the recursion limit from config or use default.
 */
export async function getRecursionLimit(): Promise<number> {
  let RECURSION_LIMIT: number = SYSTEM.DEFAULT_RECURSION_LIMIT;
  try {
    const customLimit = await ConfigManager.getRawConfig(DYNAMO_KEYS.RECURSION_LIMIT);
    if (customLimit !== undefined) {
      RECURSION_LIMIT = parseInt(String(customLimit), 10);
    }
  } catch {
    logger.warn('Failed to fetch recursion_limit from DDB, using default.');
  }
  return RECURSION_LIMIT;
}

/**
 * Handle recursion limit exceeded scenario.
 */
export async function handleRecursionLimitExceeded(
  userId: string,
  sessionId: string | undefined,
  handlerName: string,
  reason: string
): Promise<void> {
  await sendOutboundMessage(
    handlerName,
    userId,
    `⚠️ **Recursion Limit Exceeded**\n\n${reason}`,
    undefined,
    sessionId,
    'SuperClaw',
    undefined
  );
}

/**
 * Encapsulates the core agent processing logic for event handlers.
 */
export async function processEventWithAgent(
  userId: string,
  agentId: string,
  taskContent: string,
  options: {
    context: Context;
    traceId?: string;
    sessionId?: string;
    depth?: number;
    initiatorId?: string;
    attachments?: Attachment[];
    isContinuation?: boolean;
    handlerTitle: string;
    outboundHandlerName: string;
    formatResponse?: (responseText: string, attachments: Attachment[]) => string;
  }
): Promise<{ responseText: string; attachments: Attachment[] }> {
  const { AgentRegistry } = await import('../../lib/registry');
  const config = await AgentRegistry.getAgentConfig(agentId);
  if (!config) {
    logger.error(`Agent configuration for '${agentId}' not found during event processing.`);
    throw new Error(`Agent configuration for '${agentId}' not found.`);
  }

  const agentTools = await getAgentTools(agentId === 'main' ? 'events' : agentId);
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  const { responseText, attachments: resultAttachments } = await agent.process(
    userId,
    `${options.handlerTitle}: ${taskContent}`,
    {
      context: options.context,
      isContinuation: options.isContinuation,
      traceId: options.traceId,
      sessionId: options.sessionId,
      depth: options.depth,
      initiatorId: options.initiatorId,
      attachments: options.attachments,
      source: TraceSource.SYSTEM,
    }
  );

  if (!responseText.startsWith('TASK_PAUSED')) {
    const finalMessage = options.formatResponse
      ? options.formatResponse(responseText, resultAttachments || [])
      : responseText;

    await sendOutboundMessage(
      options.outboundHandlerName,
      userId,
      finalMessage,
      undefined,
      options.sessionId,
      'SuperClaw',
      resultAttachments || []
    );
  }

  return { responseText, attachments: resultAttachments || [] };
}

export { EventType, CompletionEvent, FailureEvent, sendOutboundMessage, logger };
