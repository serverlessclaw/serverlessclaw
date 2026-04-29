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
import { EventType } from '../lib/types/agent';
import * as crypto from 'crypto';

import { HANDLER_LOADERS } from './events/handlers-map';
import { validateEvent } from './events/validation';

// Verify event routing configuration on module load
verifyEventRoutingConfiguration();

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
    await routeToDlq(
      event,
      detailType,
      'SYSTEM',
      (eventDetail.traceId as string) || 'unknown',
      errorMsg,
      (eventDetail.sessionId as string) || 'system-spine'
    );
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  const traceId = eventDetail.traceId as string;
  const sessionId = eventDetail.sessionId as string;
  const workspaceId = (eventDetail.workspaceId as string) || undefined;
  const scope = { workspaceId };

  if (detailType === EventType.DLQ_ROUTE) {
    logger.warn(
      `[RECURSION] Skipping recursion tracking for DLQ_ROUTE event to prevent self-recursion (trace: ${traceId})`
    );
  } else {
    const isMission = isMissionContext(detailType, eventDetail as Record<string, unknown>);
    const recursionLimit = await getRecursionLimit({ isMissionContext: isMission });
    const currentDepth = await incrementRecursionDepth(traceId, sessionId, 'system.spine', {
      isMissionContext: isMission,
    });

    if (currentDepth > recursionLimit || currentDepth === -1) {
      logger.warn(
        `[RECURSION] Limit exceeded for trace ${traceId} (Depth: ${currentDepth}, Limit: ${recursionLimit})`
      );
      await routeToDlq(event, detailType, 'SYSTEM', traceId, `Recursion limit exceeded`, sessionId);
      emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
      return;
    }

    // Propagate updated depth to downstream handlers via eventDetail
    (eventDetail as Record<string, unknown>).depth = currentDepth;
  }

  logger.info(`[EVENTS] Received`, {
    detailType,
    sessionId: eventDetail.sessionId ?? 'N/A',
    traceId: eventDetail.traceId ?? 'unknown',
    envelopeId: envelopeId ?? 'N/A',
  });

  // Emit entry metric
  emitMetrics([METRICS.eventHandlerInvoked(detailType, scope)]).catch((err) =>
    logger.warn(`Metrics emission failed for ${detailType}:`, err)
  );

  // Flow Control (Rate limiting & Circuit breaker)
  const flowResult = await FlowController.canProceed(detailType, workspaceId);
  if (!flowResult.allowed) {
    logger.warn(`[FLOW_CONTROL] ${flowResult.reason} for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', traceId, flowResult.reason!, sessionId);
    emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
    return;
  }

  // Idempotency handling (Sh6 Fix: Use stable content hash to catch application-level double-emissions)
  // We prioritize a hash of the content over the envelopeId because envelopeId is unique per emission.
  const hash = crypto.createHash('sha256');
  const stablePayload = { ...eventDetail };
  delete (stablePayload as Record<string, unknown>).__envelopeId; // Exclude metadata
  hash.update(JSON.stringify(stablePayload) + detailType);
  const contentHash = hash.digest('hex').substring(0, 16);

  // If the event was emitted via emitEvent with a specific idempotencyKey,
  // it should be in the detail or we can use the contentHash.
  const idempotencyKey = (eventDetail.idempotencyKey as string) || contentHash;

  const alreadyProcessed = await checkAndMarkIdempotent(idempotencyKey, detailType);
  if (alreadyProcessed) {
    logger.info(
      `[EVENTS] Duplicate event detected (logical): ${idempotencyKey} (${detailType} | envelope: ${envelopeId})`
    );
    return;
  }

  // Enforce maximum retry count
  const maxRetryCount = await ConfigManager.getTypedConfig('event_max_retry_count', 3);
  const retryCount = (eventDetail.retryCount as number) ?? 0;
  if (retryCount > maxRetryCount) {
    logger.warn(`[RETRY] Exceeded max retries (${maxRetryCount}) for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', traceId, 'Max retry count exceeded', sessionId);
    emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
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

    const routingTable: Record<
      string,
      { module: string; function: string; passContext?: boolean }
    > = {
      ...DEFAULT_EVENT_ROUTING,
    };
    if (rawRoutingTable !== DEFAULT_EVENT_ROUTING) {
      for (const [eventType, entry] of Object.entries(
        rawRoutingTable as Record<string, { module: string; function: string }>
      )) {
        const routeEntry = entry as { module: string; function: string };
        const combination = `${routeEntry.module}:${routeEntry.function}`;
        if (ALLOWED_COMBINATIONS.has(combination)) {
          routingTable[eventType] = routeEntry;
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
      await routeToDlq(event, detailType, 'SYSTEM', traceId, undefined, sessionId);
      emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
      return;
    }

    // Retrieve the statically imported handler module
    let handlerModule;
    try {
      const moduleName = routing.module.split('/').pop()!;
      const loader = HANDLER_LOADERS[moduleName];
      if (!loader) {
        throw new Error(`Module ${moduleName} not found in handler loaders map`);
      }
      handlerModule = await loader();
    } catch (importError) {
      logger.error(`[SAFE_MODE] Static import lookup failed for ${routing.module}:`, importError);
      // Attempt fallback to default routing if not already using it
      if (routingTable !== DEFAULT_EVENT_ROUTING) {
        const fallback = DEFAULT_EVENT_ROUTING[detailType];
        if (fallback) {
          logger.info(`[SAFE_MODE] Recovering via default routing for ${detailType}`);
          const fallbackModuleName = fallback.module.split('/').pop()!;
          try {
            const fallbackLoader = HANDLER_LOADERS[fallbackModuleName];
            if (!fallbackLoader) {
              throw new Error(`Fallback module ${fallbackModuleName} not found in loaders map`);
            }
            handlerModule = await fallbackLoader();
          } catch (fallbackError) {
            const errorMsg = `[SAFE_MODE] Critical fallback lookup failed for ${fallbackModuleName}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
            logger.error(errorMsg);
            await routeToDlq(event, detailType, 'SYSTEM', traceId, errorMsg, sessionId);
            emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
            throw new Error(errorMsg);
          }
        } else {
          const errorMsg = `[SAFE_MODE] Primary lookup failed and no fallback exists for ${detailType}`;
          logger.error(errorMsg);
          await routeToDlq(event, detailType, 'SYSTEM', traceId, errorMsg, sessionId);
          emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
          throw new Error(errorMsg);
        }
      } else {
        const errorMsg = `Already using default routing and lookup failed: ${importError instanceof Error ? importError.message : String(importError)}`;
        logger.error(errorMsg);
        await routeToDlq(event, detailType, 'SYSTEM', traceId, errorMsg, sessionId);
        emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
        throw new Error(errorMsg);
      }
    }

    const handlerModuleTyped = handlerModule as Record<
      string,
      (event: Record<string, unknown>, contextOrType?: any, type?: string) => Promise<void>
    >;
    if (handlerModuleTyped && handlerModuleTyped[routing.function]) {
      // Inject EventBridge envelope id for idempotency dedup (used by downstream handlers)
      if (envelopeId) {
        (eventDetail as Record<string, unknown>).__envelopeId = envelopeId;
      }

      // Call the handler
      if (routing.passContext) {
        await handlerModuleTyped[routing.function](eventDetail, context, detailType);
      } else {
        await handlerModuleTyped[routing.function](eventDetail, detailType);
      }

      // Idempotency already marked atomically via checkAndMarkIdempotent before this point

      // Emit success timing metric
      const durationMs = performance.now() - startTime;
      emitMetrics([METRICS.eventHandlerDuration(detailType, durationMs, scope)]).catch((err) =>
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
    await FlowController.recordFailure(detailType, workspaceId);

    // Route to DLQ
    await routeToDlq(event, detailType, 'SYSTEM', traceId, errorMessage, sessionId);
    emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});

    // Emit error timing metric
    emitMetrics([METRICS.eventHandlerErrorDuration(detailType, elapsed, scope)]).catch((err) =>
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
