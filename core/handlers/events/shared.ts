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
import { SessionStateManager } from '../../lib/session/session-state';
import { CONFIG_DEFAULTS } from '../../lib/config/config-defaults';

/**
 * Event types that indicate mission-critical workflows with stricter recursion limits.
 * These include DAG/swarm executions and parallel task dispatches.
 *
 * NOTE: DAG dispatch is handled via PARALLEL_TASK_DISPATCH with DAG mode enabled
 * (hasDependencies=true). There is no separate DAG_TASK_DISPATCH event type -
 * the same handler serves both parallel and DAG modes for consistency.
 */
const MISSION_EVENT_TYPES = [
  EventType.DAG_TASK_COMPLETED,
  EventType.DAG_TASK_FAILED,
  EventType.PARALLEL_TASK_DISPATCH,
  EventType.PARALLEL_TASK_COMPLETED,
  EventType.PARALLEL_BARRIER_TIMEOUT, // Barrier timeout is critical for DAG recovery
];

/**
 * Determine if the current event context is mission-critical.
 * @param eventType - The event type to check
 * @param metadata - Optional metadata that might indicate mission context
 */
export function isMissionContext(eventType?: string, metadata?: Record<string, unknown>): boolean {
  // Check if event type indicates a mission
  if (eventType && MISSION_EVENT_TYPES.includes(eventType as EventType)) {
    return true;
  }
  // Check metadata for mission flag
  if (metadata?.isMission === true) {
    return true;
  }
  return false;
}

/**
 * Unified recursion guard for event handlers and multiplexers.
 * Checks the cross-session recursion depth and pushes a new entry if within limits.
 *
 * @param traceId - The trace ID for the execution chain.
 * @param sessionId - The session ID for the execution.
 * @param agentId - The agent ID performing the task.
 * @param depthFromEvent - The depth passed in the event payload (as a hint).
 * @param isMission - Whether this is a mission-critical context.
 * @returns A promise resolving to the current depth if successful, or null if limit exceeded.
 */
export async function checkAndPushRecursion(
  traceId: string,
  sessionId: string,
  agentId: string,
  depthFromEvent?: number,
  isMission: boolean = false
): Promise<number | null> {
  const { getRecursionDepth, pushRecursionEntry } = await import('../../lib/recursion-tracker');

  const RECURSION_LIMIT = await getRecursionLimit(isMission);
  const currentDepth = await getRecursionDepth(traceId);

  if (currentDepth >= RECURSION_LIMIT) {
    logger.error(
      `[RECURSION] Limit exceeded for trace ${traceId} at depth ${currentDepth} (limit: ${RECURSION_LIMIT})`
    );
    return null;
  }

  // Use the event hint if it's deeper, but monotonic guard in pushRecursionEntry
  // handles the actual safety in DynamoDB. Pass isMission for TTL handling.
  const targetDepth = Math.max(currentDepth + 1, (depthFromEvent ?? 0) + 1);

  await pushRecursionEntry(traceId, targetDepth, sessionId, agentId, isMission);
  return targetDepth;
}

/**
 * Wake up the initiator agent when a delegated task or system event completes.
...
 * @param userId - The ID of the user.
 * @param initiatorId - The ID of the agent that initiated the task.
 * @param task - The task name or identifier.
 * @param traceId - Optional trace ID for tracking.
 * @param sessionId - Optional session identifier.
 * @param depth - Current recursion depth.
 * @param userNotified - Whether the user has already been notified of this task completion.
 * @param options - Optional array of interactive button options to include in the wakeup message.
 * @param taskId - Optional stable task ID to maintain identity across continuation.
 * @param eventType - Optional event type to use (defaults to CONTINUATION_TASK).
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

  // Determine if the initiator is a human (user) or another agent.
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

  // Detect mission context and use appropriate recursion limit
  // Boundary: depth starts at 0. If limit is 15, allow depth 0-14, block at 15+.
  // This uses >= for safety to prevent runaway recursion in agent handoffs.
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
 * Get the recursion limit from config or use default.
 * Validates that mission_recursion_limit <= recursion_limit to prevent limit bypass.
 * @param isMission - Whether this is a mission-critical workflow (uses stricter limit)
 */
export async function getRecursionLimit(isMission: boolean = false): Promise<number> {
  const { CONFIG_DEFAULTS } = await import('../../lib/config/config-defaults');

  // Get general recursion limit (upper bound)
  let generalLimit: number = SYSTEM.DEFAULT_RECURSION_LIMIT;
  try {
    const customLimit = await ConfigManager.getRawConfig(DYNAMO_KEYS.RECURSION_LIMIT);
    if (customLimit !== undefined) {
      generalLimit = parseConfigInt(customLimit, SYSTEM.DEFAULT_RECURSION_LIMIT);
    }
  } catch {
    logger.warn('Failed to fetch recursion_limit from DDB, using default.');
  }

  // Use mission-specific limit if this is a mission context
  if (isMission) {
    let missionLimit: number = CONFIG_DEFAULTS.MISSION_RECURSION_LIMIT.code;
    try {
      const customMissionLimit = await ConfigManager.getRawConfig('mission_recursion_limit');
      if (customMissionLimit !== undefined) {
        missionLimit = parseConfigInt(
          customMissionLimit,
          CONFIG_DEFAULTS.MISSION_RECURSION_LIMIT.code
        );
      }
    } catch {
      logger.warn('Failed to fetch mission_recursion_limit from DDB, using default.');
    }

    // Validate: mission limit cannot exceed general limit (prevents limit bypass)
    if (missionLimit > generalLimit) {
      logger.warn(
        `mission_recursion_limit (${missionLimit}) exceeds recursion_limit (${generalLimit}). ` +
          `Using general limit for mission context.`
      );
      return generalLimit;
    }

    return missionLimit;
  }

  return generalLimit;
}

/**
 * Handle recursion limit exceeded scenario by informing the user and emitting a failure event.
 *
 * @param userId - The ID of the user.
 * @param sessionId - Optional session identifier.
 * @param handlerName - The name of the handler reporting the limit.
 * @param reason - The reason for recursion limit.
 * @param traceId - Trace ID of the failed operation.
 * @param initiatorId - The agent that was supposed to be woken up.
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

  // 1. Inform user
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

  // 2. Emit failure event for automated system awareness
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
      depth: 99, // Sentinel for limit hit
    });
  } catch (err) {
    logger.error('Failed to emit TASK_FAILED for recursion limit:', err);
  }
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
): Promise<{ responseText: string; attachments: Attachment[]; parsedData?: any }> {
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

  // 0. Concurrency Control (Phase B3: Real-time Shared Awareness)
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

    // Get heartbeat interval from config or use default (60 seconds)
    let heartbeatMs: number = CONFIG_DEFAULTS.SESSION_LOCK_HEARTBEAT_MS.code;
    try {
      const configuredHeartbeat = await ConfigManager.getRawConfig('session_lock_heartbeat_ms');
      if (typeof configuredHeartbeat === 'number' && configuredHeartbeat > 0) {
        heartbeatMs = configuredHeartbeat;
      }
    } catch {
      logger.warn('Failed to fetch session_lock_heartbeat_ms from DDB, using default.');
    }

    // Start heartbeat to renew lock (B3: Real-time Shared Awareness)
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    if (options.sessionId) {
      heartbeatInterval = setInterval(async () => {
        try {
          const renewed = await sessionStateManager.renewProcessing(
            options.sessionId!,
            `event-handler-${agentId}`
          );
          if (!renewed) {
            logger.warn(
              `[${options.handlerTitle}] Failed to renew lock for ${options.sessionId}. Lock may have been stolen or expired.`
            );
          }
        } catch (err) {
          logger.error(`[${options.handlerTitle}] Heartbeat error for ${options.sessionId}:`, err);
        }
      }, heartbeatMs);
    }

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

    // resultAttachments from agent.stream are not directly returned as a single array,
    // they are usually added to memory or yielded in chunks if the provider/executor supports it.
    const isValidAttachment = (rawAtt: unknown): rawAtt is Attachment => {
      if (!rawAtt || typeof rawAtt !== 'object') return false;
      const a = rawAtt as Record<string, unknown>;
      if (typeof a.url === 'string' && a.url.length > 0) return true;
      if (typeof a.base64 === 'string' && a.base64.length > 0) return true;
      return false;
    };

    try {
      for await (const chunk of stream) {
        if (chunk.content) responseText += chunk.content;
        if (chunk.attachments && Array.isArray(chunk.attachments)) {
          for (const rawAtt of chunk.attachments) {
            if (isValidAttachment(rawAtt)) attachments.push(rawAtt as Attachment);
            else logger.warn('[EVENTS.SHARED] Skipping invalid stream attachment');
          }
        }
      }
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    }

    const isPaused = isTaskPaused(responseText);

    // 1. Extract message if JSON (Phase B3: Real-time Shared Awareness)
    let finalMessage = responseText;
    let parsedData: any = null;
    try {
      if (responseText.trim().startsWith('{')) {
        parsedData = JSON.parse(responseText);
        finalMessage = parsedData.message || parsedData.plan || parsedData.response || responseText;
      }
    } catch {
      // Fallback to raw response if not valid JSON
    }

    // 1. Notify user (unless it's a background pause/continuation or skip requested)
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

    // 2. Notify initiator if it's another agent (Closing the completion gap)
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
        metadata: {
          durationMs: Date.now() - startTime,
        },
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
