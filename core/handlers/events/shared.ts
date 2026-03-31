import { EventType } from '../../lib/types/index';
import { sendOutboundMessage } from '../../lib/outbound';
import { logger } from '../../lib/logger';
import { SYSTEM, DYNAMO_KEYS } from '../../lib/constants';
import { ConfigManager } from '../../lib/registry/config';
import { emitEvent } from '../../lib/utils/bus';
import { TraceSource, Attachment } from '../../lib/types/index';
import { Context } from 'aws-lambda';
import { parseConfigInt } from '../../lib/providers/utils';
import { isTaskPaused } from '../../lib/utils/agent-helpers';

/**
 * Wake up the initiator agent when a delegated task or system event completes.
 *
 * @param userId - The ID of the user.
 * @param initiatorId - The ID of the agent that initiated the task.
 * @param task - The task name or identifier.
 * @param traceId - Optional trace ID for tracking.
 * @param sessionId - Optional session identifier.
 * @param depth - Current recursion depth.
 * @param userNotified - Whether the user has already been notified of this task completion.
 * @param options - Optional array of interactive button options to include in the wakeup message.
 */
export async function wakeupInitiator(
  userId: string,
  initiatorId: string | undefined,
  task: string,
  traceId: string | undefined,
  sessionId: string | undefined,
  depth: number = 0,
  userNotified: boolean = false,
  options?: { label: string; value: string; type?: 'primary' | 'secondary' | 'danger' }[]
): Promise<void> {
  if (!initiatorId || !task) return;

  const finalTask = userNotified ? `${task}\n(USER_ALREADY_NOTIFIED: true)` : task;

  // Determine if the initiator is a human (user) or another agent.
  // Agents have specific IDs like 'superclaw', 'coder', or dynamic UUIDs.
  // Humans are identified by the base userId (numeric string for Telegram, 'dashboard-user' for Dashboard).
  const isHuman =
    initiatorId === userId || initiatorId === 'dashboard-user' || /^\d+$/.test(initiatorId);

  if (isHuman) {
    await sendOutboundMessage(
      'wakeup-initiator',
      userId,
      task,
      undefined,
      sessionId,
      'SuperClaw',
      undefined,
      traceId,
      options
    );
    return;
  }

  await emitEvent('events.handler', EventType.CONTINUATION_TASK, {
    userId,
    agentId: initiatorId,
    task: finalTask,
    traceId,
    initiatorId,
    sessionId,
    depth: depth + 1,
    options,
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
      RECURSION_LIMIT = parseConfigInt(customLimit, SYSTEM.DEFAULT_RECURSION_LIMIT);
    }
  } catch {
    logger.warn('Failed to fetch recursion_limit from DDB, using default.');
  }
  return RECURSION_LIMIT;
}

/**
 * Handle recursion limit exceeded scenario by informing the user.
 *
 * @param userId - The ID of the user.
 * @param sessionId - Optional session identifier.
 * @param handlerName - The name of the handler reporting the limit.
 * @param reason - The reason for recursion limit.
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
 *
 * @param userId - The ID of the user.
 * @param agentId - The ID of the agent to process the event.
 * @param taskContent - The content of the task to perform.
 * @param options - Additional options for execution.
 * @returns A promise resolving to the agent response and attachments.
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
  // Heavy SDK dependencies loaded lazily to keep this module's static import depth low.
  const { Agent } = await import('../../lib/agent');
  const { getAgentContext } = await import('../../lib/utils/agent-helpers');
  const { memory, provider } = await getAgentContext();
  const { AgentRegistry } = await import('../../lib/registry');
  const config = await AgentRegistry.getAgentConfig(agentId);
  if (!config) {
    logger.error(`Agent configuration for '${agentId}' not found during event processing.`);
    throw new Error(`Agent configuration for '${agentId}' not found.`);
  }

  const { getAgentTools: loadAgentTools } = await import('../../tools/index');
  const agentTools = await loadAgentTools(agentId);
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  const stream = agent.stream(userId, `${options.handlerTitle}: ${taskContent}`, {
    context: options.context,
    isContinuation: options.isContinuation,
    traceId: options.traceId,
    sessionId: options.sessionId,
    depth: options.depth,
    initiatorId: options.initiatorId,
    attachments: options.attachments,
    source: TraceSource.SYSTEM,
  });

  let responseText = '';
  // resultAttachments from agent.stream are not directly returned as a single array,
  // they are usually added to memory or yielded in chunks if the provider/executor supports it.
  // In our current Agent.stream implementation, attachments are persistent in memory.
  for await (const chunk of stream) {
    if (chunk.content) responseText += chunk.content;
  }

  if (!isTaskPaused(responseText) && responseText.trim().length > 0) {
    const finalMessage = options.formatResponse
      ? options.formatResponse(responseText, [])
      : responseText;

    const messageId = agentId === 'superclaw' ? options.traceId : `${options.traceId}-${agentId}`;

    await sendOutboundMessage(
      options.outboundHandlerName,
      userId,
      finalMessage,
      undefined,
      options.sessionId,
      'SuperClaw',
      [],
      messageId
    );
  }

  return { responseText, attachments: [] };
}
