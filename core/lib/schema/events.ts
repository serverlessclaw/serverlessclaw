import { z } from 'zod';

const AttachmentSchema = z.object({
  type: z.enum(['image', 'file']),
  url: z.string().optional(),
  base64: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
});

/**
 * Base schema for all event payloads.
 */
export const BaseEventSchema = z.object({
  source: z.string().optional(),
  userId: z.string().optional(),
  traceId: z.string().optional(),
  agentId: z.string().optional(),
  initiatorId: z.string().optional(),
  depth: z.number().optional(),
  sessionId: z.string().optional(),
  timestamp: z.number().optional(),
});

/**
 * Schema for AgentPayload.
 */
export const AgentPayloadSchema = BaseEventSchema.extend({
  task: z.string().optional(),
  response: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(AttachmentSchema).optional(),
  isContinuation: z.boolean().optional(),
});

/**
 * Schema for TaskEvent.
 */
export const TaskEventSchema = BaseEventSchema.extend({
  userId: z.string(),
  task: z.string(),
  isContinuation: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

/**
 * Schema for BuildEvent.
 */
export const BuildEventSchema = BaseEventSchema.extend({
  userId: z.string(),
  buildId: z.string(),
  projectName: z.string().optional(),
  task: z.string().optional(),
  errorLogs: z.string().optional(),
  gapIds: z.array(z.string()).optional(),
});

/**
 * Schema for CompletionEvent.
 */
export const CompletionEventSchema = BaseEventSchema.extend({
  userId: z.string(),
  agentId: z.string(),
  task: z.string(),
  response: z.string(),
  attachments: z.array(AttachmentSchema).optional(),
});

/**
 * Schema for OutboundMessageEvent.
 */
export const OutboundMessageEventSchema = BaseEventSchema.extend({
  userId: z.string(),
  message: z.string(),
  agentName: z.string().optional(),
  memoryContexts: z.array(z.string()).optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

/**
 * Schema for FailureEvent.
 */
export const FailureEventSchema = BaseEventSchema.extend({
  userId: z.string(),
  agentId: z.string(),
  task: z.string(),
  error: z.string(),
});

/**
 * Schema for HealthReportEvent.
 */
export const HealthReportEventSchema = BaseEventSchema.extend({
  userId: z.string(),
  component: z.string(),
  issue: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for ProactiveHeartbeatPayload.
 */
export const ProactiveHeartbeatPayloadSchema = BaseEventSchema.extend({
  agentId: z.string(),
  task: z.string(),
  goalId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for the detail payload of a BridgeEvent.
 * Allows for userId, sessionId, and other unknown properties.
 */
const BridgeDetailPayloadSchema = z
  .object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();

/**
 * Schema for BridgeEvent, which bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 * Extends a base event structure and includes a detail-type and the detail payload.
 */
export const BridgeEventSchema = z
  .object({
    'detail-type': z.string(), // EventBridge detail-type
    detail: BridgeDetailPayloadSchema,
  })
  .passthrough(); // Allows other EventBridge event properties if any
