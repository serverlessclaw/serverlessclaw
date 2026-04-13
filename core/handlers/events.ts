import { logger } from '../lib/logger';
import { reportHealthIssue } from '../lib/lifecycle/health';
import { Context } from 'aws-lambda';
import { routeToDlq } from './route-to-dlq';
import { checkAndMarkIdempotent } from './events/idempotency';
import { emitMetrics, METRICS } from '../lib/metrics';
import { ConfigManager } from '../lib/registry/config';
import { DEFAULT_EVENT_ROUTING, verifyEventRoutingConfiguration } from '../lib/event-routing';
import { performance } from 'perf_hooks';
import { getRecursionDepth } from '../lib/recursion-tracker';
import { CONFIG_DEFAULTS } from '../lib/config/config-defaults';

// Verify event routing configuration on module load
verifyEventRoutingConfiguration();

// In‑memory state (distributed state migration planned for Sprint 2)
const failureState = new Map<string, { count: number; openedAt?: number }>();
const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function getRateBucket(key: string, capacity: number, refillMs: number) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    rateBuckets.set(key, bucket);
    return bucket;
  }
  const elapsed = now - bucket.lastRefill;
  const refillInterval = refillMs / capacity;
  if (elapsed >= refillInterval) {
    // Refill proportionally to elapsed time
    const refillTokens = Math.floor(elapsed / refillInterval);
    bucket.tokens = Math.min(capacity, bucket.tokens + refillTokens);
    bucket.lastRefill = now - Math.floor(elapsed % refillInterval); // Preserve precision
  }
  return bucket;
}

function consumeToken(key: string, capacity: number, refillMs: number): boolean {
  const bucket = getRateBucket(key, capacity, refillMs);
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return true;
  }
  return false;
}

function isCircuitOpen(key: string, threshold: number, timeoutMs: number): boolean {
  const state = failureState.get(key);
  if (!state) return false;
  if (state.count >= threshold) {
    const now = Date.now();
    if (state.openedAt && now - state.openedAt < timeoutMs) {
      return true;
    }
    // Timeout elapsed – reset
    failureState.delete(key);
    return false;
  }
  return false;
}

function recordFailure(key: string, threshold: number) {
  const now = Date.now();
  let state = failureState.get(key);
  if (!state) {
    state = { count: 1 };
    failureState.set(key, state);
  } else {
    state.count++;
  }

  if (state.count >= threshold && !state.openedAt) {
    state.openedAt = now;
  }
}

function startExecutionTimeout(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

/**
 * Simple schema validation for incoming event details.
 */
function validateEvent(detailType: string, eventDetail: Record<string, unknown>): {
  valid: boolean;
  errors?: string[];
} {
  // Allow system health reports to pass without sessionId for now
  if (detailType === 'system_health_report') {
    return { valid: true };
  }

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

  // Load configuration thresholds
  const [
    circuitThreshold,
    circuitTimeout,
    rateCapacity,
    rateRefill,
    maxRetryCount,
    executionTimeout,
  ] = await Promise.all([
    ConfigManager.getTypedConfig(
      CONFIG_DEFAULTS.EVENT_CIRCUIT_THRESHOLD.configKey!,
      CONFIG_DEFAULTS.EVENT_CIRCUIT_THRESHOLD.code
    ),
    ConfigManager.getTypedConfig(
      CONFIG_DEFAULTS.EVENT_CIRCUIT_TIMEOUT_MS.configKey!,
      CONFIG_DEFAULTS.EVENT_CIRCUIT_TIMEOUT_MS.code
    ),
    ConfigManager.getTypedConfig(
      CONFIG_DEFAULTS.EVENT_RATE_BUCKET_CAPACITY.configKey!,
      CONFIG_DEFAULTS.EVENT_RATE_BUCKET_CAPACITY.code
    ),
    ConfigManager.getTypedConfig(
      CONFIG_DEFAULTS.EVENT_RATE_BUCKET_REFILL_MS.configKey!,
      CONFIG_DEFAULTS.EVENT_RATE_BUCKET_REFILL_MS.code
    ),
    ConfigManager.getTypedConfig(
      CONFIG_DEFAULTS.EVENT_MAX_RETRY_COUNT.configKey!,
      CONFIG_DEFAULTS.EVENT_MAX_RETRY_COUNT.code
    ),
    ConfigManager.getTypedConfig(
      CONFIG_DEFAULTS.EVENT_EXECUTION_TIMEOUT_MS.configKey!,
      CONFIG_DEFAULTS.EVENT_EXECUTION_TIMEOUT_MS.code
    ),
  ]);

  // Validate payload
  const validation = validateEvent(detailType, eventDetail);
  if (!validation.valid) {
    logger.warn(`[VALIDATION] Missing required fields: ${validation.errors?.join(', ')}`);
  }

  // Recursion depth enforcement using unified DynamoDB-based recursion tracker
  // Retrieve configured recursion limit (default is 15 if not set)
  const recursionLimit = await ConfigManager.getTypedConfig('recursion_limit', 15);
  // Get traceId from event detail for unified tracking
  const traceId = eventDetail.traceId as string;

  if (!traceId) {
    logger.warn(`[RECURSION] Missing traceId in event ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', `Missing traceId`);
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  // Get current depth from DynamoDB (authoritative source)
  const existingDepth = await getRecursionDepth(traceId);
  const currentDepth = existingDepth + 1;

  if (typeof recursionLimit === 'number' && currentDepth > recursionLimit) {
    logger.warn(
      `[RECURSION] Depth ${currentDepth} exceeds limit ${recursionLimit} for trace ${traceId}`
    );
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

  // Authoritative update: Push the entry to DynamoDB for cross-session tracking
  await (
    await import('../lib/recursion-tracker')
  ).pushRecursionEntry(
    traceId,
    currentDepth,
    (eventDetail.sessionId as string) || 'unknown',
    'system.spine'
  );

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

  // Rate limiting
  if (!(await consumeToken(detailType, rateCapacity, rateRefill))) {
    logger.warn(`[RATE_LIMIT] Rate limit exceeded for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', 'Rate limit exceeded');
    emitMetrics([METRICS.rateLimitExceeded(detailType), METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  // Circuit breaker
  if (isCircuitOpen(detailType, circuitThreshold, circuitTimeout)) {
    logger.warn(`[CIRCUIT] Circuit open for ${detailType}`);
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', 'Circuit breaker open');
    emitMetrics([METRICS.circuitBreakerTriggered('event'), METRICS.dlqEvents(1)]).catch(() => {});
    return;
  }

  // Execution timeout guard (not currently used by downstream calls)
  const _abortCtrl = startExecutionTimeout(executionTimeout);

  // Idempotency handling (deterministic key for events without envelopeId)
  let idempotencyKey = envelopeId;
  if (!idempotencyKey) {
    const crypto = await import('crypto');
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

    // Record failure for circuit breaker
    recordFailure(detailType, circuitThreshold);

    // Route to DLQ
    await routeToDlq(event, detailType, 'SYSTEM', 'unknown', errorMessage);
    emitMetrics([METRICS.dlqEvents(1)]).catch(() => {});

    // Emit error timing metric
    emitMetrics([METRICS.eventHandlerErrorDuration(detailType, elapsed)]).catch((err) =>
      logger.warn(`Metrics emission failed for ${detailType} error:`, err)
    );

    // Break recursion loop: Don't report health issues about health reports
    if (detailType === 'system_health_report') {
      logger.error('[RECURSION_DEBT] Suppressing health report for failed health report processing');
    } else {
      await reportHealthIssue({
        component: 'EventHandler',
        issue: `Failed to process event ${detailType}: ${errorMessage}`,
        severity: 'high',
        userId: 'SYSTEM',
        traceId: 'unknown',
        context: { detailType, error: errorMessage },
      });
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}
