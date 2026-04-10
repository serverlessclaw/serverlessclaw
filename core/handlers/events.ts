import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/lifecycle/health';
import { Context } from 'aws-lambda';
import { routeToDlq } from './route-to-dlq';
import { checkIdempotency, markIdempotent } from './events/idempotency';
import { emitMetrics, METRICS } from '../lib/metrics';
import { ConfigManager } from '../lib/registry/config';
import { DEFAULT_EVENT_ROUTING } from '../lib/event-routing';
import { performance } from 'perf_hooks';

// Circuit breaker configuration
const CIRCUIT_THRESHOLD = 5; // failures before opening
const CIRCUIT_TIMEOUT_MS = 60_000; // 1 minute before reset

// Rate limiting configuration (token bucket)
const RATE_BUCKET_CAPACITY = 10;
const RATE_BUCKET_REFILL_MS = 1_000;

// Maximum retry count for events
const MAX_RETRY_COUNT = 5;

// Execution timeout (per invocation)
const EXECUTION_TIMEOUT_MS = 5_000;

// In‑memory state
const failureState = new Map<string, { count: number; openedAt?: number }>();
const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function getRateBucket(key: string) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: RATE_BUCKET_CAPACITY, lastRefill: now };
    rateBuckets.set(key, bucket);
    return bucket;
  }
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= RATE_BUCKET_REFILL_MS) {
    const refillTokens = Math.min(RATE_BUCKET_CAPACITY, bucket.tokens + RATE_BUCKET_CAPACITY);
    bucket.tokens = refillTokens;
    bucket.lastRefill = now;
  }
  return bucket;
}

function consumeToken(key: string): boolean {
  const bucket = getRateBucket(key);
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return true;
  }
  return false;
}

function isCircuitOpen(key: string): boolean {
  const state = failureState.get(key);
  if (!state) return false;
  if (state.count >= CIRCUIT_THRESHOLD) {
    const now = Date.now();
    if (state.openedAt && now - state.openedAt < CIRCUIT_TIMEOUT_MS) {
      return true;
    }
    // Timeout elapsed – reset
    failureState.delete(key);
    return false;
  }
  return false;
}

function recordFailure(key: string) {
  const now = Date.now();
  const state = failureState.get(key);
  if (!state) {
    failureState.set(key, { count: 1 });
  } else {
    state.count++;
    if (state.count >= CIRCUIT_THRESHOLD && !state.openedAt) {
      state.openedAt = now;
    }
  }
}

function startExecutionTimeout(): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);
  return controller;
}

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

  // Validate payload
  const validation = validateEvent(eventDetail);
  if (!validation.valid) {
    logger.warn(`[VALIDATION] Missing required fields: ${validation.errors?.join(', ')}`);
  }

  // Recursion depth enforcement
  // Retrieve configured recursion limit (default is 15 if not set)
  const recursionLimit = await ConfigManager.getTypedConfig('recursion_limit', 15);
  // Determine current depth (default 0 if not provided)
  let currentDepth = (eventDetail as any).depth ?? 0;
  currentDepth += 1;
  if (typeof recursionLimit === 'number' && currentDepth > recursionLimit) {
    logger.warn(`[RECURSION] Depth ${currentDepth} exceeds limit ${recursionLimit}`);
    await routeToDlq(
      event,
      detailType,
      'SYSTEM',
      'unknown',
      `Recursion limit exceeded (${currentDepth}/${recursionLimit})`
    );
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }
  // Propagate updated depth to downstream handlers
  (eventDetail as any).depth = currentDepth;

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

  // Rate limiting
  if (!consumeToken(detailType)) {
    logger.warn(`[RATE_LIMIT] Rate limit exceeded for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', 'Rate limit exceeded');
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  // Circuit breaker
  if (isCircuitOpen(detailType)) {
    logger.warn(`[CIRCUIT] Circuit open for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', 'Circuit breaker open');
    emitMetrics([METRICS.circuitBreakerTriggered('deploy')]).catch(() => {});
    return;
  }

  // Execution timeout guard (not currently used by downstream calls)
  const _abortCtrl = startExecutionTimeout();

  // Idempotency handling (deterministic key for events without envelopeId)
  let idempotencyKey = envelopeId;
  if (!idempotencyKey) {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(eventDetail) + detailType);
    idempotencyKey = hash.digest('hex').substring(0, 16);
  }

  const alreadyProcessed = await checkIdempotency(idempotencyKey, detailType);
  if (alreadyProcessed) {
    logger.info(`[EVENTS] Duplicate event detected: ${idempotencyKey} (${detailType})`);
    return;
  }

  // Enforce maximum retry count
  const retryCount = (eventDetail.retryCount as number) ?? 0;
  if (retryCount > MAX_RETRY_COUNT) {
    logger.warn(`[RETRY] Exceeded max retries (${MAX_RETRY_COUNT}) for ${detailType}`);
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
    if (!routing) {
      logger.warn(`Unhandled event type: ${detailType}. Routing to DLQ.`);
      await routeToDlq(event, detailType, 'SYSTEM', 'unknown');
      emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
      return;
    }

    // Dynamically import the handler module
    let handlerModule;
    try {
      const moduleName = routing.module.split('/').pop();
      handlerModule = await import(`./events/${moduleName}.ts`);
    } catch (importError) {
      logger.error(`[SAFE_MODE] Import failed for ${routing.module}:`, importError);
      // Attempt fallback to default routing if not already using it
      if (routingTable !== DEFAULT_EVENT_ROUTING) {
        const fallback = DEFAULT_EVENT_ROUTING[detailType];
        if (fallback) {
          logger.info(`[SAFE_MODE] Recovering via default routing for ${detailType}`);
          const fallbackModuleName = fallback.module.split('/').pop();
          try {
            handlerModule = await import(`./events/${fallbackModuleName}.ts`);
          } catch (fallbackError) {
            const errorMsg = `[SAFE_MODE] Critical fallback import failed for ${fallbackModuleName}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
            logger.error(errorMsg);
            await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMsg);
            emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
            throw new Error(errorMsg);
          }
        } else {
          const errorMsg = `[SAFE_MODE] Primary import failed and no fallback exists for ${detailType}`;
          logger.error(errorMsg);
          await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMsg);
          emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
          throw new Error(errorMsg);
        }
      } else {
        const errorMsg = `Already using default routing and import failed: ${importError instanceof Error ? importError.message : String(importError)}`;
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

      // Mark event as processed for idempotency
      await markIdempotent(idempotencyKey, detailType);

      // Call the handler
      if (routing.passContext) {
        await handlerModule[routing.function](eventDetail, context, detailType);
      } else {
        await handlerModule[routing.function](eventDetail, detailType);
      }

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

    // Record failure for circuit breaker
    recordFailure(detailType);

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
