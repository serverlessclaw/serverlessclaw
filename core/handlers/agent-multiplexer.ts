import { AgentType, EventType } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { handleWarmup } from '../lib/utils/agent-helpers';
import { SessionStateManager } from '../lib/session/session-state';

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
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

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
    case EventType.CODER_TASK_COMPLETED: // QA often triggers on coder completion
    case EventType.SYSTEM_BUILD_SUCCESS: // QA also triggers on build success
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
      // Check if it's a dynamic agent or explicitly specified in the payload
      targetAgent = detail.agentId as AgentType;
      if (targetAgent) {
        // Dynamic agents are still handled by Agent Runner usually,
        // but the multiplexer could potentially handle them if imported.
        // For now, we fall back to manual routing or error.
      }
  }

  if (!targetAgent || !handlerPath) {
    logger.warn(
      `[MULTIPLEXER] No specific agent routing for ${detailType}. Passing to Event Handler if applicable.`
    );
    return;
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

    // Start heartbeat to renew lock (B3: Real-time Shared Awareness)
    // Renew every 60 seconds for tasks that may take longer (e.g., Coder)
    heartbeatInterval = setInterval(async () => {
      try {
        const renewed = await sessionStateManager.renewProcessing(sessionId, targetAgent!);
        if (!renewed) {
          logger.warn(
            `[MULTIPLEXER] Failed to renew lock for ${sessionId}. Lock may have been stolen or expired.`
          );
        }
      } catch (err) {
        logger.error(`[MULTIPLEXER] Heartbeat error for ${sessionId}:`, err);
      }
    }, 60000);
  }

  try {
    // 4. Dispatch to Agent Logic
    logger.info(`[MULTIPLEXER] Dispatching to ${targetAgent}...`);
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
    // Cleanup: Clear heartbeat and release lock
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    if (lockAcquired && sessionId && targetAgent) {
      await sessionStateManager.releaseProcessing(sessionId, targetAgent);
    }
  }
};
