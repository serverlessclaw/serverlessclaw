import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/lifecycle/health';
import { Context } from 'aws-lambda';

/**
 * Main entry point for the Events Handler.
 * Routes different EventBridge event types to specialized handlers via dynamic imports.
 * Dynamic imports are used to reduce import depth and improve AI signal clarity for the main entry point.
 *
 * @param event - The EventBridge event containing detail-type and detail.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves when the event has been processed.
 */
export async function handler(
  event: {
    'detail-type': string;
    detail: Record<string, unknown>;
    id?: string;
  },
  context: Context
): Promise<void> {
  const detailType = event['detail-type'];
  const eventDetail = event.detail;
  const envelopeId = event.id;

  logger.info(`[EVENTS] Received: ${detailType} | Session: ${eventDetail.sessionId ?? 'N/A'}`);

  try {
    const { emitMetrics, METRICS } = await import('../lib/metrics');
    emitMetrics([METRICS.agentInvoked(detailType)]).catch((err) =>
      logger.warn(`Metrics emission failed for ${detailType}:`, err)
    );
  } catch {
    // metrics module may not be available in all environments
  }

  const userId = (eventDetail.userId as string) ?? 'SYSTEM';
  const traceId = (eventDetail.traceId as string) ?? 'unknown';

  // Idempotency check: verify this event hasn't been processed recently
  // This prevents duplicate processing during retry storms
  if (envelopeId) {
    const { checkIdempotency } = await import('./events/idempotency');
    const alreadyProcessed = await checkIdempotency(envelopeId, detailType);
    if (alreadyProcessed) {
      logger.info(`[EVENTS] Duplicate event detected: ${envelopeId} (${detailType}). Skipping.`);
      return;
    }
  }

  try {
    const { ConfigManager } = await import('../lib/registry/config');
    const { DEFAULT_EVENT_ROUTING } = await import('../lib/event-routing');

    // Build an allowlist of permitted module:function pairs from the hardcoded defaults.
    // DDB-loaded routing entries must resolve to one of these known-good combinations
    // to prevent a misconfigured or tampered ConfigTable entry from redirecting
    // event handling to an arbitrary Lambda module or unintended function.
    const ALLOWED_COMBINATIONS = new Set(
      Object.values(DEFAULT_EVENT_ROUTING).map((r) => `${r.module}:${r.function}`)
    );

    // Fetch routing table from DDB with hardcoded fallback
    const rawRoutingTable = await ConfigManager.getTypedConfig(
      'event_routing_table',
      DEFAULT_EVENT_ROUTING
    );

    // Security: validate each DDB-loaded entry against the allowlist.
    // Any entry with an unrecognised combination is removed and the default is used instead.
    const routingTable: typeof DEFAULT_EVENT_ROUTING = { ...DEFAULT_EVENT_ROUTING };
    if (rawRoutingTable !== DEFAULT_EVENT_ROUTING) {
      for (const [eventType, entry] of Object.entries(rawRoutingTable)) {
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

    if (routing) {
      let handlerModule;
      try {
        // 1. Try to import from configured module (DDB or Fallback)
        const moduleName = routing.module.split('/').pop();
        handlerModule = await import(`./events/${moduleName}.ts`);
      } catch (importError) {
        logger.error(
          `[SAFE_MODE] Import failed for ${routing.module}. Attempting recovery...`,
          importError
        );

        // 2. Recovery: Fallback to hardcoded DEFAULT_EVENT_ROUTING if not already using it
        if (routingTable !== DEFAULT_EVENT_ROUTING) {
          const fallback = DEFAULT_EVENT_ROUTING[detailType];
          if (fallback) {
            logger.info(`[SAFE_MODE] Recovering via default routing for ${detailType}`);
            const fallbackModuleName = fallback.module.split('/').pop();
            try {
              handlerModule = await import(`./events/${fallbackModuleName}.ts`);
            } catch (fallbackError) {
              const fallbackErrorMsg = `[SAFE_MODE] Critical fallback import failed for ${fallbackModuleName}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
              logger.error(fallbackErrorMsg);
              throw new Error(fallbackErrorMsg);
            }
          } else {
            const noFallbackError = `[SAFE_MODE] Primary import failed for ${routing.module} and no fallback exists for ${detailType}`;
            logger.error(noFallbackError);
            throw new Error(noFallbackError);
          }
        } else {
          // Already using DEFAULT_EVENT_ROUTING and it failed
          throw importError;
        }
      }

      if (handlerModule && handlerModule[routing.function]) {
        // Inject EventBridge envelope id for idempotency dedup
        if (envelopeId) {
          eventDetail.__envelopeId = envelopeId;
        }
        if (routing.passContext) {
          await handlerModule[routing.function](eventDetail, context, detailType);
        } else {
          await handlerModule[routing.function](eventDetail, detailType);
        }

        // Mark event as processed for idempotency
        if (envelopeId) {
          const { markIdempotent } = await import('./events/idempotency');
          await markIdempotent(envelopeId, detailType);
        }

        return; // Success - don't route to DLQ
      } else {
        const errorMsg = `Handler function ${routing.function} missing in module ${routing.module}`;
        logger.error(`[SAFE_MODE] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    // Unhandled event type - route to DLQ for retry instead of hard throwing
    logger.warn(`Unhandled event type: ${detailType}. Routing to DLQ for retry.`);
    await routeToDlq(event, detailType, userId, traceId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`EventHandler failed for ${detailType}: ${errorMessage}`, error);

    // Route failed events to DLQ for potential retry
    if (detailType) {
      await routeToDlq(event, detailType, userId, traceId, errorMessage);
    }

    await reportHealthIssue({
      component: 'EventHandler',
      issue: `Failed to process event ${detailType}: ${errorMessage}`,
      severity: 'high',
      userId,
      traceId,
      context: { detailType },
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Route an unhandled or failed event to the Dead Letter Queue for retry.
 */
async function routeToDlq(
  event: { 'detail-type': string; detail: Record<string, unknown>; id?: string },
  detailType: string,
  userId: string,
  traceId: string,
  errorMessage?: string
): Promise<void> {
  try {
    const { emitEvent } = await import('../lib/utils/bus');
    const { EventType } = await import('../lib/types/agent');

    // Use DLQ_ROUTE for routing failed events
    await emitEvent('events.handler', EventType.DLQ_ROUTE, {
      eventCategory: 'dlq_routing',
      detailType,
      originalEvent: event.detail,
      envelopeId: event.id,
      userId,
      traceId,
      errorMessage,
      retryCount: (event.detail.retryCount as number) ?? 0,
      timestamp: Date.now(),
    });
    logger.info(`[EVENTS] Event ${detailType} routed to DLQ for retry`);
  } catch (dlqError) {
    // DLQ routing failed - report health issue but don't block
    logger.error(`[EVENTS] Failed to route to DLQ:`, dlqError);
    await reportHealthIssue({
      component: 'EventHandler',
      issue: `Failed to route unhandled event to DLQ: ${detailType}`,
      severity: 'high',
      userId,
      traceId,
      context: { detailType, dlqError: String(dlqError) },
    });
    throw new Error(`Unhandled event type: ${detailType}`);
  }
}
