import { ConfigManager } from '../../lib/registry/config';
import { DEFAULT_EVENT_ROUTING } from '../../lib/event-routing';
import { HANDLER_LOADERS } from './handlers-map';
import { routeToDlq } from '../route-to-dlq';
import { emitMetrics, METRICS } from '../../lib/metrics';

/**
 * Resolves the appropriate handler for a given event type.
 */
export async function getHandlerForEvent(
  event: any,
  detailType: string,
  traceId: string,
  sessionId: string,
  eventDetail: any
) {
  const { logger: localLogger } = await import('../../lib/logger');
  const workspaceId = (eventDetail?.workspaceId as string) || undefined;
  const scope = { workspaceId };

  // Fetch routing configuration
  const rawRoutingTable = await ConfigManager.getTypedConfig(
    'event_routing_table',
    DEFAULT_EVENT_ROUTING
  );
  const ALLOWED_COMBINATIONS = new Set(
    Object.values(DEFAULT_EVENT_ROUTING).map((r) => `${r.module}:${r.function}`)
  );

  const routingTable: Record<string, { module: string; function: string; passContext?: boolean }> =
    {
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
        localLogger.warn(
          `[SECURITY] Blocked unrecognised routing combination '${combination}' for event type '${eventType}'. Using default.`
        );
      }
    }
  }

  const routing = routingTable[detailType] || DEFAULT_EVENT_ROUTING[detailType];
  if (!routing) {
    localLogger.warn(`Unhandled event type: ${detailType}. Routing to DLQ.`);
    await routeToDlq(event, detailType, 'SYSTEM', traceId, undefined, sessionId, workspaceId);
    emitMetrics([METRICS.dlqEvents(1, scope)]).catch(() => {});
    return null;
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
    localLogger.error(
      `[SAFE_MODE] Static import lookup failed for ${routing.module}:`,
      importError
    );
    // Fallback logic...
    if (routingTable !== DEFAULT_EVENT_ROUTING) {
      const fallback = DEFAULT_EVENT_ROUTING[detailType];
      if (fallback) {
        localLogger.info(`[SAFE_MODE] Recovering via default routing for ${detailType}`);
        const fallbackModuleName = fallback.module.split('/').pop()!;
        try {
          const fallbackLoader = HANDLER_LOADERS[fallbackModuleName];
          if (!fallbackLoader) {
            throw new Error(`Fallback module ${fallbackModuleName} not found in loaders map`);
          }
          handlerModule = await fallbackLoader();
        } catch (fallbackError: any) {
          throw new Error(
            `Critical fallback lookup failed for ${fallbackModuleName}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
          );
        }
      } else {
        throw new Error(`Primary lookup failed and no fallback exists for ${detailType}`);
      }
    } else {
      throw new Error(`Already using default routing and lookup failed`);
    }
  }

  return { handlerModule, routing };
}
