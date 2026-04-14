import { EventType } from '../../lib/types/index';
import { sendOutboundMessage } from '../../lib/outbound';
import { logger } from '../../lib/logger';
import { emitEvent } from '../../lib/utils/bus';
import { TraceSource, Attachment } from '../../lib/types/index';
import { Context } from 'aws-lambda';
import { isTaskPaused } from '../../lib/utils/agent-helpers';
import { SessionStateManager } from '../../lib/session/session-state';
import { incrementRecursionDepth, getRecursionLimit } from '../../lib/recursion-tracker';

/**
 * Event types that indicate mission-critical workflows with stricter recursion limits.
 * These include DAG/swarm executions and parallel task dispatches.
 */
const MISSION_EVENT_TYPES = [
  EventType.DAG_TASK_COMPLETED,
  EventType.DAG_TASK_FAILED,
  EventType.PARALLEL_TASK_DISPATCH,
  EventType.PARALLEL_TASK_COMPLETED,
  EventType.PARALLEL_BARRIER_TIMEOUT,
];

/**
 * Determine if the current event context is mission-critical.
 * @param eventType - The event type to check
 * @param metadata - Optional metadata that might indicate mission context
 */
export function isMissionContext(eventType?: string, metadata?: Record<string, unknown>): boolean {
  if (eventType && MISSION_EVENT_TYPES.includes(eventType as EventType)) {
    return true;
  }
  if (metadata?.isMission === true) {
    return true;
  }
  return false;
}

/**
 * Unified recursion guard for event handlers and multiplexers.
 * Uses atomic monotonic increment to prevent bypass.
 *
 * @param traceId - The trace ID for the execution chain.
 * @param sessionId - The session ID for the execution.
 * @param agentId - The agent ID performing the task.
 * @param isMission - Whether this is a mission-critical context.
 * @returns A promise resolving to the current depth if successful, or null if limit exceeded.
 */
export async function checkAndPushRecursion(
  traceId: string,
  sessionId: string,
  agentId: string,
  isMission: boolean = false
): Promise<number | null> {
  const RECURSION_LIMIT = await getRecursionLimit(isMission);
  const newDepth = await incrementRecursionDepth(traceId, sessionId, agentId, isMission);

  if (newDepth > RECURSION_LIMIT || newDepth === -1) {
    logger.error(
      `[RECURSION] Limit exceeded for trace ${traceId} at depth ${newDepth} (limit: ${RECURSION_LIMIT})`
    );
    return null;
  }

  return newDepth;
}

/**
 * Wake up the initiator agent when a delegated task or system event completes.
 */
export async function wakeupInitiator(
  userId: string,
  initiatorId: string | undefined,
  task: string,
  traceId: string | undefined,
  sessionId: string | undefined,
  depth: number = 0,
  userNotified: boolean = false,
  options?: { label: string; value: string; type?: 'primary' | 'secondary' | 'danger' }[],
  taskId?: string,
  eventType: EventType | string = EventType.CONTINUATION_TASK
): Promise<void> {
  if (!initiatorId || !task) return;

  const finalTask = userNotified ? `${task}\n(USER_ALREADY_NOTIFIED: true)` : task;

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

  const missionContext = isMissionContext(eventType as string);
  const RECURSION_LIMIT = await getRecursionLimit(missionContext);

  if (depth >= RECURSION_LIMIT) {
    logger.error(
      `Recursion Limit Exceeded (Depth: ${depth}) for user ${userId}. Aborting continuation.`
    );
    await handleRecursionLimitExceeded(
      userId,
      sessionId,
      'wakeup-initiator',
      `I have detected an infinite loop between agents (Depth: ${depth}). I've intervened to stop the process.`,
      traceId,
      initiatorId
    );
    return;
  }

  await emitEvent('events.handler', eventType as EventType, {
    userId,
    agentId: initiatorId,
    task: finalTask,
    traceId,
    taskId: taskId ?? traceId,
    initiatorId,
    sessionId,
    depth: depth + 1,
    options,
  });
}

/**
 * Handle recursion limit exceeded scenario by informing the user and emitting a failure event.
 */
export async function handleRecursionLimitExceeded(
  userId: string,
  sessionId: string | undefined,
  handlerName: string,
  reason: string,
  traceId?: string,
  initiatorId?: string
): Promise<void> {
  const finalMessage = `⚠️ **Recursion Limit Exceeded**\n\n${reason}`;

  await sendOutboundMessage(
    handlerName,
    userId,
    finalMessage,
    undefined,
    sessionId,
    'SuperClaw',
    undefined,
    traceId
  );

  try {
    const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
    await emitTypedEvent(handlerName, EventType.TASK_FAILED, {
      userId,
      agentId: initiatorId ?? 'unknown',
      task: 'wakeup-continuation',
      error: `RECURSION_LIMIT_EXCEEDED: ${reason}`,
      traceId,
      sessionId,
      initiatorId: 'system.supervisor',
      depth: 99,
    });
  } catch (err) {
    logger.error('Failed to emit TASK_FAILED for recursion limit:', err);
  }
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
    taskId?: string;
    sessionId?: string;
    depth?: number;
    initiatorId?: string;
    attachments?: Attachment[];
    isContinuation?: boolean;
    handlerTitle: string;
    outboundHandlerName: string;
    skipOutbound?: boolean;
    formatResponse?: (responseText: string, attachments: Attachment[]) => string;
    tokenBudget?: number;
    costLimit?: number;
    priorTokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }
): Promise<{
  responseText: string;
  attachments: Attachment[];
  parsedData?: Record<string, unknown> | null;
}> {
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

  const sessionStateManager = new SessionStateManager();
  if (options.sessionId) {
    const lockAcquired = await sessionStateManager.acquireProcessing(
      options.sessionId,
      `event-handler-${agentId}`
    );

    if (!lockAcquired) {
      logger.info(
        `[${options.handlerTitle}] Session ${options.sessionId} busy. Queueing task for ${agentId}.`
      );
      await sessionStateManager.addPendingMessage(
        options.sessionId,
        `${options.handlerTitle}: ${taskContent}`,
        options.attachments
      );
      return {
        responseText: `[QUEUED] Session busy. Task added to pending queue for ${agentId}.`,
        attachments: [],
      };
    }
  }

  try {
    const startTime = Date.now();

    const stream = agent.stream(userId, `${options.handlerTitle}: ${taskContent}`, {
      context: options.context,
      isContinuation: options.isContinuation,
      traceId: options.traceId,
      taskId: options.taskId,
      sessionId: options.sessionId,
      depth: options.depth,
      initiatorId: options.initiatorId,
      attachments: options.attachments,
      source: TraceSource.SYSTEM,
      sessionStateManager,
      tokenBudget: options.tokenBudget,
      costLimit: options.costLimit,
      priorTokenUsage: options.priorTokenUsage,
    });

    let responseText = '';
    const attachments: Attachment[] = [];

    const isValidAttachment = (rawAtt: unknown): rawAtt is Attachment => {
      if (!rawAtt || typeof rawAtt !== 'object') return false;
      const a = rawAtt as Record<string, unknown>;
      return (
        (typeof a.url === 'string' && a.url.length > 0) ||
        (typeof a.base64 === 'string' && a.base64.length > 0)
      );
    };

    for await (const chunk of stream) {
      if (chunk.content) responseText += chunk.content;
      if (chunk.attachments && Array.isArray(chunk.attachments)) {
        for (const rawAtt of chunk.attachments) {
          if (isValidAttachment(rawAtt)) attachments.push(rawAtt as Attachment);
        }
      }
    }

    const isPaused = isTaskPaused(responseText);
    let finalMessage = responseText;
    let parsedData: Record<string, unknown> | null = null;

    try {
      if (responseText.trim().startsWith('{')) {
        parsedData = JSON.parse(responseText);
        finalMessage =
          (parsedData?.message as string) ||
          (parsedData?.plan as string) ||
          (parsedData?.response as string) ||
          responseText;
      }
    } catch {
      // Fallback
    }

    if (!isPaused && responseText.trim().length > 0 && !options.skipOutbound) {
      const formattedMessage = options.formatResponse
        ? options.formatResponse(finalMessage, attachments)
        : finalMessage;

      const messageId = agentId === 'superclaw' ? options.traceId : `${options.traceId}-${agentId}`;

      await sendOutboundMessage(
        options.outboundHandlerName,
        userId,
        formattedMessage,
        undefined,
        options.sessionId,
        options.handlerTitle === 'SuperClaw' ? 'SuperClaw' : options.handlerTitle,
        attachments,
        messageId
      );
    }

    if (
      !isPaused &&
      options.initiatorId &&
      options.initiatorId !== 'orchestrator' &&
      options.initiatorId !== userId
    ) {
      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
      await emitTypedEvent(agentId, EventType.TASK_COMPLETED, {
        userId,
        agentId,
        task: taskContent,
        response: finalMessage,
        attachments,
        traceId: options.traceId,
        taskId: options.taskId ?? options.traceId,
        initiatorId: options.initiatorId,
        depth: (options.depth ?? 0) + 1,
        sessionId: options.sessionId,
        metadata: { durationMs: Date.now() - startTime },
      });
    }

    return { responseText: finalMessage, attachments, parsedData };
  } finally {
    if (options.sessionId) {
      await sessionStateManager.releaseProcessing(options.sessionId, agentId);
    }
  }
}

/**
 * Report an internal health issue to the system monitor.
 */
export async function reportHealthIssue(params: {
  component: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId: string;
  traceId?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await emitEvent('events.shared', EventType.SYSTEM_HEALTH_REPORT, params);
}
