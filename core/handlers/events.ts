import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/lifecycle/health';
import { Context } from 'aws-lambda';
import { routeToDlq } from './route-to-dlq';
import { checkAndMarkIdempotent } from './events/idempotency';
import { emitMetrics, METRICS } from '../lib/metrics';
import { ConfigManager } from '../lib/registry/config';
import { DEFAULT_EVENT_ROUTING, verifyEventRoutingConfiguration } from '../lib/event-routing';
import { performance } from 'perf_hooks';
import { FlowController } from '../lib/routing/flow-controller';
import { isMissionContext } from './events/shared';
import { incrementRecursionDepth, getRecursionLimit } from '../lib/recursion-tracker';
import * as crypto from 'crypto';

import * as buildHandler from './events/build-handler';
import * as continuationHandler from './events/continuation-handler';
import * as healthHandler from './events/health-handler';
import * as taskResultHandler from './events/task-result-handler';
import * as clarificationHandler from './events/clarification-handler';
import * as clarificationTimeoutHandler from './events/clarification-timeout-handler';
import * as parallelHandler from './events/parallel-handler';
import * as parallelBarrierTimeoutHandler from './events/parallel-barrier-timeout-handler';
import * as parallelTaskCompletedHandler from './events/parallel-task-completed-handler';
import * as dagSupervisorHandler from './events/dag-supervisor-handler';
import * as cancellationHandler from './events/cancellation-handler';
import * as proactiveHandler from './events/proactive-handler';
import * as escalationHandler from './events/escalation-handler';
import * as consensusHandler from './events/consensus-handler';
import * as cognitiveHealthHandler from './events/cognitive-health-handler';
import * as strategicTieBreakHandler from './events/strategic-tie-break-handler';
import * as reportBackHandler from './events/report-back-handler';
import * as auditHandler from './events/audit-handler';
import * as recoveryHandler from './events/recovery-handler';
import * as dashboardFailureHandler from './events/dashboard-failure-handler';
import * as dlqHandler from './events/dlq-handler';
import * as reputationHandler from './events/reputation-handler';

const STATIC_HANDLERS: Record<string, any> = {
  'build-handler': buildHandler,
  'continuation-handler': continuationHandler,
  'health-handler': healthHandler,
  'task-result-handler': taskResultHandler,
  'clarification-handler': clarificationHandler,
  'clarification-timeout-handler': clarificationTimeoutHandler,
  'parallel-handler': parallelHandler,
  'parallel-barrier-timeout-handler': parallelBarrierTimeoutHandler,
  'parallel-task-completed-handler': parallelTaskCompletedHandler,
  'dag-supervisor-handler': dagSupervisorHandler,
  'cancellation-handler': cancellationHandler,
  'proactive-handler': proactiveHandler,
  'escalation-handler': escalationHandler,
  'consensus-handler': consensusHandler,
  'cognitive-health-handler': cognitiveHealthHandler,
  'strategic-tie-break-handler': strategicTieBreakHandler,
  'report-back-handler': reportBackHandler,
  'audit-handler': auditHandler,
  'recovery-handler': recoveryHandler,
  'dashboard-failure-handler': dashboardFailureHandler,
  'dlq-handler': dlqHandler,
  'reputation-handler': reputationHandler,
};

// Verify event routing configuration on module load
verifyEventRoutingConfiguration();

/**
 * Simple schema validation for incoming event details.
 */
function validateEvent(eventDetail: Record<string, unknown>): {
  valid: boolean;
  errors?: string[];
} {
  const requiredFields = ['sessionId', 'traceId'];
  const missing = requiredFields.filter((field) => !(field in eventDetail));
  if (missing.length > 0) {
    return { valid: false, errors: missing };
  }
  return { valid: true };
}

export async function handler(
  event: {
    'detail-type': string;
    detail: Record<string, unknown>;
    id?: string;
  },
  context: Context
): Promise<void> {
  const startTime = performance.now();
  const detailType = event['detail-type'];
  const eventDetail = event.detail;
  const envelopeId = event.id;

  // Validate payload - Enforce strict requirements for sessionId and traceId
  const validation = validateEvent(eventDetail);
  if (!validation.valid) {
    const errorMsg = `[VALIDATION] Missing required fields: ${validation.errors?.join(', ')}`;
    logger.error(errorMsg);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMsg);
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  const traceId = eventDetail.traceId as string;
  const sessionId = eventDetail.sessionId as string;

  const isMission = isMissionContext(detailType, eventDetail as Record<string, unknown>);
  const recursionLimit = await getRecursionLimit(isMission);
  const currentDepth = await incrementRecursionDepth(traceId, sessionId, 'system.spine', isMission);

  if (currentDepth > recursionLimit || currentDepth === -1) {
    logger.warn(
      `[RECURSION] Limit exceeded for trace ${traceId} (Depth: ${currentDepth}, Limit: ${recursionLimit})`
    );
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', `Recursion limit exceeded`);
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  // Propagate updated depth to downstream handlers via eventDetail
  (eventDetail as Record<string, unknown>).depth = currentDepth;

  logger.info(`[EVENTS] Received`, {
    detailType,
    sessionId: eventDetail.sessionId ?? 'N/A',
    traceId: eventDetail.traceId ?? 'unknown',
    envelopeId: envelopeId ?? 'N/A',
  });

  // Emit entry metric
  emitMetrics([METRICS.eventHandlerInvoked(detailType)]).catch((err) =>
    logger.warn(`Metrics emission failed for ${detailType}:`, err)
  );

  // Flow Control (Rate limiting & Circuit breaker)
  const flowResult = await FlowController.canProceed(detailType);
  if (!flowResult.allowed) {
    logger.warn(`[FLOW_CONTROL] ${flowResult.reason} for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', flowResult.reason!);
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  // Idempotency handling (deterministic key for events without envelopeId)
  let idempotencyKey = envelopeId;
  if (!idempotencyKey) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(eventDetail) + detailType);
    idempotencyKey = hash.digest('hex').substring(0, 16);
  }

  const alreadyProcessed = await checkAndMarkIdempotent(idempotencyKey, detailType);
  if (alreadyProcessed) {
    logger.info(`[EVENTS] Duplicate event detected: ${idempotencyKey} (${detailType})`);
    return;
  }

  // Enforce maximum retry count
  const maxRetryCount = await ConfigManager.getTypedConfig('event_max_retry_count', 3);
  const retryCount = (eventDetail.retryCount as number) ?? 0;
  if (retryCount > maxRetryCount) {
    logger.warn(`[RETRY] Exceeded max retries (${maxRetryCount}) for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', 'Max retry count exceeded');
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  try {
    // Fetch routing configuration
    const rawRoutingTable = await ConfigManager.getTypedConfig(
      'event_routing_table',
      DEFAULT_EVENT_ROUTING
    );
    const ALLOWED_COMBINATIONS = new Set(
      Object.values(DEFAULT_EVENT_ROUTING).map((r) => `${r.module}:${r.function}`)
    );

    const routingTable: typeof DEFAULT_EVENT_ROUTING = { ...DEFAULT_EVENT_ROUTING };
    if (rawRoutingTable !== DEFAULT_EVENT_ROUTING) {
      for (const [eventType, entry] of Object.entries(rawRoutingTable as Record<string, any>)) {
        const combination = `${entry.module}:${entry.function}`;
        if (ALLOWED_COMBINATIONS.has(combination)) {
          routingTable[eventType] = entry;
        } else {
          logger.warn(
            `[SECURITY] Blocked unrecognised routing combination '${combination}' for event type '${eventType}'. Using default.`
          );
        }
      }
    }

    const routing = routingTable[detailType] || DEFAULT_EVENT_ROUTING[detailType];
    if (!routing) {
      logger.warn(`Unhandled event type: ${detailType}. Routing to DLQ.`);
      await routeToDlq(event, detailType, 'SYSTEM', 'unknown');
      emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
      return;
    }

    // Retrieve the statically imported handler module
    let handlerModule;
    try {
      const moduleName = routing.module.split('/').pop()!;
      handlerModule = STATIC_HANDLERS[moduleName];
      if (!handlerModule) {
        throw new Error(`Module ${moduleName} not found in static handlers map`);
      }
    } catch (importError) {
      logger.error(`[SAFE_MODE] Static import lookup failed for ${routing.module}:`, importError);
      // Attempt fallback to default routing if not already using it
      if (routingTable !== DEFAULT_EVENT_ROUTING) {
        const fallback = DEFAULT_EVENT_ROUTING[detailType];
        if (fallback) {
          logger.info(`[SAFE_MODE] Recovering via default routing for ${detailType}`);
          const fallbackModuleName = fallback.module.split('/').pop()!;
          try {
            handlerModule = STATIC_HANDLERS[fallbackModuleName];
            if (!handlerModule) {
              throw new Error(`Fallback module ${fallbackModuleName} not found in static map`);
            }
          } catch (fallbackError) {
            const errorMsg = `[SAFE_MODE] Critical fallback lookup failed for ${fallbackModuleName}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
            logger.error(errorMsg);
            await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMsg);
            emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
            throw new Error(errorMsg);
          }
        } else {
          const errorMsg = `[SAFE_MODE] Primary lookup failed and no fallback exists for ${detailType}`;
          logger.error(errorMsg);
          await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMsg);
          emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
          throw new Error(errorMsg);
        }
      } else {
        const errorMsg = `Already using default routing and lookup failed: ${importError instanceof Error ? importError.message : String(importError)}`;
        logger.error(errorMsg);
        await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMsg);
        emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
        throw new Error(errorMsg);
      }
    }

    if (handlerModule && handlerModule[routing.function]) {
      // Inject EventBridge envelope id for idempotency dedup (used by downstream handlers)
      if (envelopeId) {
        eventDetail.__envelopeId = envelopeId;
      }

      // Call the handler
      if (routing.passContext) {
        await handlerModule[routing.function](eventDetail, context, detailType);
      } else {
        await handlerModule[routing.function](eventDetail, detailType);
      }

      // Idempotency already marked atomically via checkAndMarkIdempotent before this point

      // Emit success timing metric
      const durationMs = performance.now() - startTime;
      emitMetrics([METRICS.eventHandlerDuration(detailType, durationMs)]).catch((err) =>
        logger.warn(`Metrics emission failed for ${detailType} duration:`, err)
      );

      return;
    } else {
      const errorMsg = `Handler function ${routing.function} missing in module ${routing.module}`;
      logger.error(`[SAFE_MODE] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const elapsed = performance.now() - startTime;

    logger.error(`EventHandler failed for ${detailType}: ${errorMessage}`, error);

    // Record failure for flow control
    await FlowController.recordFailure(detailType);

    // Route to DLQ
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMessage);
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});

    // Emit error timing metric
    emitMetrics([METRICS.eventHandlerErrorDuration(detailType, elapsed)]).catch((err) =>
      logger.warn(`Metrics emission failed for ${detailType} error:`, err)
    );

    await reportHealthIssue({
      component: 'EventHandler',
      issue: `Failed to process event ${detailType}: ${errorMessage}`,
      severity: 'high',
      userId: 'SYSTEM',
      traceId: 'unknown',
      context: { detailType, error: errorMessage },
    });

    throw error instanceof Error ? error : new Error(String(error));
  }
}
