import { EventType } from '../types/index';
import { logger } from '../logger';
import {
  EVENT_SCHEMA_MAP,
  CompletionEventPayload,
  FailureEventPayload,
  OutboundMessageEventPayload,
  HealthReportEventPayload,
  ProactiveHeartbeatPayloadInferred,
} from '../schema/events';
import { emitEvent, EventOptions } from './bus';

/**
 * Validates and emits an event to the AgentBus with full structural enforcement.
 * Throws an error if the detail does not match the schema for the given type.
 *
 * Accepts any EventType or string key — the schema is looked up at runtime.
 * If no schema exists for the type, the event is emitted without validation.
 *
 * @param source - The originating component name.
 * @param type - The EventType to emit.
 * @param detail - The event payload to validate and send.
 * @param options - Optional emission controls (priority, retries, etc).
 */
export async function emitTypedEvent(
  source: string,
  type: EventType | string,
  detail: unknown,
  options: EventOptions = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  const schema = EVENT_SCHEMA_MAP[type as string];

  if (!schema) {
    // No schema — emit without validation (not all event types have schemas yet)
    return await emitEvent(source, type as EventType, detail as Record<string, unknown>, options);
  }

  try {
    const validatedDetail = schema.parse(detail);

    return await emitEvent(
      source,
      type as EventType,
      validatedDetail as Record<string, unknown>,
      options
    );
  } catch (error) {
    logger.error(`Validation failed for ${type} from ${source}:`, error);
    throw error;
  }
}

/**
 * Validates and emits an event, but falls back to logging a warning instead of throwing
 * on validation failure. Use this for non-critical logging events.
 */
export async function emitTypedEventSafe(
  source: string,
  type: EventType | string,
  detail: unknown,
  options: EventOptions = {}
): Promise<{ success: boolean; eventId?: string; reason?: string }> {
  try {
    return await emitTypedEvent(source, type, detail, options);
  } catch (error) {
    logger.warn(`Safe emit failed validation for ${type}, sending raw anyway:`, error);
    return await emitEvent(source, type as EventType, detail as Record<string, unknown>, options);
  }
}

/** Helper: Emit Task Completed event. */
export const emitTaskCompleted = (
  source: string,
  detail: Partial<CompletionEventPayload>,
  opts?: EventOptions
) => emitTypedEvent(source, EventType.TASK_COMPLETED, detail, opts);

/** Helper: Emit Task Failed event. */
export const emitTaskFailed = (
  source: string,
  detail: Partial<FailureEventPayload>,
  opts?: EventOptions
) => emitTypedEvent(source, EventType.TASK_FAILED, detail, opts);

/** Helper: Emit Outbound Message event. */
export const emitOutboundMessage = (
  source: string,
  detail: Partial<OutboundMessageEventPayload>,
  opts?: EventOptions
) => emitTypedEvent(source, EventType.OUTBOUND_MESSAGE, detail, opts);

/** Helper: Emit Health Report event. */
export const emitHealthReport = (
  source: string,
  detail: Partial<HealthReportEventPayload>,
  opts?: EventOptions
) => emitTypedEvent(source, EventType.SYSTEM_HEALTH_REPORT, detail, opts);

/** Helper: Emit Proactive Heartbeat event. */
export const emitProactiveHeartbeat = (
  source: string,
  detail: Partial<ProactiveHeartbeatPayloadInferred>,
  opts?: EventOptions
) => emitTypedEvent(source, EventType.HEARTBEAT_PROACTIVE, detail, opts);
