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
  },
  context: Context
): Promise<void> {
  const detailType = event['detail-type'];
  const eventDetail = event.detail;

  console.log(`[EVENTS] Received: ${detailType} | Session: ${eventDetail.sessionId ?? 'N/A'}`);
  logger.info('EventHandler received event:', JSON.stringify(event, null, 2));

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

  try {
    const { ConfigManager } = await import('../lib/registry/config');
    const { DEFAULT_EVENT_ROUTING } = await import('../lib/event-routing');

    // Fetch routing table from DDB with hardcoded fallback
    const routingTable = await ConfigManager.getTypedConfig(
      'event_routing_table',
      DEFAULT_EVENT_ROUTING
    );

    const routing = routingTable[detailType] || DEFAULT_EVENT_ROUTING[detailType];

    if (routing) {
      let handlerModule;
      try {
        // 1. Try to import from configured module (DDB or Fallback)
        const cleanModulePath = routing.module.startsWith('./')
          ? routing.module.substring(2)
          : routing.module;
        handlerModule = await import(`./${cleanModulePath}`);
      } catch (importError) {
        logger.error(`[SAFE_MODE] Import failed for ${routing.module}. Attempting recovery...`, importError);
        
        // 2. Recovery: Fallback to hardcoded DEFAULT_EVENT_ROUTING if not already using it
        if (routingTable !== DEFAULT_EVENT_ROUTING) {
          const fallback = DEFAULT_EVENT_ROUTING[detailType];
          if (fallback) {
            logger.info(`[SAFE_MODE] Recovering via default routing for ${detailType}`);
            const cleanFallbackPath = fallback.module.startsWith('./')
              ? fallback.module.substring(2)
              : fallback.module;
            try {
              handlerModule = await import(`./${cleanFallbackPath}`);
            } catch (fallbackError) {
              logger.error(`[SAFE_MODE] Critical fallback import failed for ${cleanFallbackPath}:`, fallbackError);
            }
          }
        }
      }

      if (handlerModule && handlerModule[routing.function]) {
        if (routing.passContext) {
          await handlerModule[routing.function](eventDetail, context, detailType);
        } else {
          await handlerModule[routing.function](eventDetail, detailType);
        }
      } else {
        const errorMsg = `Handler function ${routing.function} missing in module ${routing.module}`;
        logger.error(`[SAFE_MODE] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    } else {
      logger.warn(`Unhandled event type: ${detailType}`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`EventHandler failed for ${detailType}: ${errorMessage}`, error);
    await reportHealthIssue({
      component: 'EventHandler',
      issue: `Failed to process event ${detailType}: ${errorMessage}`,
      severity: 'high',
      userId,
      traceId,
      context: { detailType },
    });
  }
}
