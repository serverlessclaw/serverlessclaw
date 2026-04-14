import { AgentType, EventType } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { handleWarmup } from '../lib/utils/agent-helpers';
import { SessionStateManager } from '../lib/session/session-state';
import { checkCollaborationTimeout } from '../lib/conflict-resolution';

/**
 * Agent Multiplexer (Mono-lambda).
 * Routes incoming EventBridge tasks to the specialized agent logic.
 * Consolidated into a single high-performance Lambda to reduce cold-start latency.
 */
export const handler = async (
  event: Record<string, unknown>,
  context: Context
): Promise<unknown> => {
  const detailType = (event['detail-type'] as string) || (event.type as string);

  // 1. Handle Centralized Warmup
  // If no specific agent is targeted, we warm the core cognitive suite.
  if (await handleWarmup(event, 'brain')) {
    // Record warm state in DynamoDB to complete the smart warmup loop
    const tier = process.env.MULTIPLEXER_TIER;
    if (tier) {
      try {
        const { WarmupManager } = await import('../lib/warmup');
        const warmupManager = new WarmupManager({ servers: {}, agents: {}, ttlSeconds: 900 });
        await warmupManager.recordWarmState({
          server: tier,
          lastWarmed: new Date().toISOString(),
          warmedBy: 'webhook',
          ttl: Math.floor(Date.now() / 1000) + 900,
        });
      } catch (e) {
        logger.warn(`[MULTIPLEXER] Failed to record warm state for ${tier}:`, e);
      }
    }
    logger.info(`[MULTIPLEXER] ${tier ? tier.toUpperCase() : 'Suite'} warmed and ready.`);
    return 'WARM';
  }

  logger.info(`[MULTIPLEXER] Received ${detailType}`, { requestId: context.awsRequestId });

  // 2. Extract session context for session locking (B3: Real-time Shared Awareness)
  const detail = (event.detail as Record<string, unknown>) || {};
  const sessionId = (detail.sessionId as string) || (event.sessionId as string);
  // Note: traceId and userId are preserved for future use (e.g., logging, tracing)
  const _traceId = (detail.traceId as string) || (event.traceId as string);
  const _userId = (detail.userId as string) || (event.userId as string);

  // Session lock management
  const sessionStateManager = new SessionStateManager();

  // 3. Identify Target Agent
  let targetAgent: AgentType | undefined;
  let handlerPath: string | undefined;

  switch (detailType) {
    case EventType.CODER_TASK:
      targetAgent = AgentType.CODER;
      handlerPath = '../agents/coder';
      break;
    case EventType.RESEARCH_TASK:
      targetAgent = AgentType.RESEARCHER;
      handlerPath = '../agents/researcher';
      break;
    case EventType.CRITIC_TASK:
      targetAgent = AgentType.CRITIC;
      handlerPath = '../agents/critic';
      break;
    case EventType.FACILITATOR_TASK:
      targetAgent = AgentType.FACILITATOR;
      handlerPath = '../agents/facilitator';
      break;
    case EventType.MERGER_TASK:
      targetAgent = AgentType.MERGER;
      handlerPath = '../agents/merger';
      break;
    case EventType.QA_TASK:
    case EventType.CODER_TASK_COMPLETED:
    case EventType.SYSTEM_BUILD_SUCCESS:
      targetAgent = AgentType.QA;
      handlerPath = '../agents/qa';
      break;
    case EventType.EVOLUTION_PLAN:
    case EventType.STRATEGIC_PLANNER_TASK:
      targetAgent = AgentType.STRATEGIC_PLANNER;
      handlerPath = '../agents/strategic-planner';
      break;
    case EventType.REFLECT_TASK:
    case EventType.COGNITION_REFLECTOR_TASK:
      targetAgent = AgentType.COGNITION_REFLECTOR;
      handlerPath = '../agents/cognition-reflector';
      break;
    default:
      // Check if it's a dynamic agent or explicitly specified in the payload (P2 Gap Fix)
      targetAgent = (detail.agentId as AgentType) || (event.agentId as AgentType);
      if (targetAgent && detailType.startsWith('dynamic_')) {
        logger.info(`[MULTIPLEXER] Routing dynamic agent ${targetAgent} to Agent Runner.`);
        handlerPath = './agent-runner';
      }
  }

  if (!targetAgent || !handlerPath) {
    logger.warn(
      `[MULTIPLEXER] No specific agent routing for ${detailType}. Passing to Event Handler if applicable.`
    );
    return;
  }

  // Check collaboration timeout if this is part of an active session
  if (sessionId && _traceId) {
    const sessionState = await sessionStateManager.getState(sessionId);
    if (sessionState && sessionState.lastMessageAt) {
      const isTimedOut = await checkCollaborationTimeout(
        {
          sessionId,
          lastActivityAt: sessionState.lastMessageAt,
          userId: _userId,
          task: (detail.task as string) || (event.task as string),
          agentId: targetAgent,
        },
        _traceId
      );
      // If a timeout is triggered, the event is emitted by checkCollaborationTimeout
      // We must STOP processing to avoid race conditions with the strategic tie-break (P1 Fix)
      if (isTimedOut) {
        logger.warn(
          `[MULTIPLEXER] Session ${sessionId} timed out. Yielding to strategic tie-break.`
        );
        return { status: 'TIMEOUT', message: 'Task terminated due to session timeout.' };
      }
    }
  }

  // Acquire session lock if sessionId is available (B3: Prevent Mutual Exclusion Violation)
  let lockAcquired = false;

  if (sessionId && targetAgent) {
    lockAcquired = await sessionStateManager.acquireProcessing(sessionId, targetAgent);

    if (!lockAcquired) {
      logger.info(`[MULTIPLEXER] Session ${sessionId} busy. Queueing task for ${targetAgent}.`);
      await sessionStateManager.addPendingMessage(sessionId, `${targetAgent}: ${detailType}`, []);
      return {
        status: 'QUEUED',
        message: `Session busy. Task added to pending queue for ${targetAgent}.`,
      };
    }
  }

  const { isMissionContext, checkAndPushRecursion } = await import('./events/shared');
  const isMission = isMissionContext(detailType, detail as Record<string, unknown>);

  if (_traceId && targetAgent) {
    const currentDepth = await checkAndPushRecursion(
      _traceId,
      sessionId || 'unknown',
      targetAgent,
      isMission
    );

    if (currentDepth === null) {
      if (lockAcquired && sessionId) {
        await sessionStateManager.releaseProcessing(sessionId, targetAgent);
      }
      return `Error: Recursion limit exceeded for trace ${_traceId}`;
    }

    // Propagate updated depth to downstream handlers via eventDetail (if mutated further)
    (detail as Record<string, unknown>).depth = currentDepth;
  }

  try {
    // 4. Dispatch to Agent Logic
    logger.info(`[MULTIPLEXER] Dispatching to ${targetAgent}...`);

    // Ensure lock is renewed just before dispatch to give the next handler full TTL
    if (lockAcquired && sessionId && targetAgent) {
      await sessionStateManager.renewProcessing(sessionId, targetAgent);
    }

    const agentModule = await import(handlerPath);

    if (typeof agentModule.handler === 'function') {
      return await agentModule.handler(event, context);
    } else {
      throw new Error(`Agent ${targetAgent} does not export a valid handler function.`);
    }
  } catch (error) {
    logger.error(`[MULTIPLEXER] Failed to execute agent ${targetAgent}:`, error);
    throw error;
  } finally {
    // Cleanup: release lock
    if (lockAcquired && sessionId && targetAgent) {
      await sessionStateManager.releaseProcessing(sessionId, targetAgent);
    }
  }
};
