import { z } from 'zod';
import { AttachmentType } from '../types/llm';
import { HealthSeverity, ParallelTaskStatus } from '../types/constants';

export const ATTACHMENT_SCHEMA = z.object({
  type: z.nativeEnum(AttachmentType),
  url: z.string().optional(),
  base64: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
});

/**
 * Base schema for all event payloads.
 */
export const BASE_EVENT_SCHEMA = z.object({
  source: z.string().default('unknown'),
  userId: z.string().default('SYSTEM'),
  traceId: z.string().optional(),
  agentId: z.string().optional(),
  initiatorId: z.string().default('orchestrator'),
  depth: z.number().default(0),
  sessionId: z.string().optional(),
  timestamp: z.number().default(() => Date.now()),
});

/**
 * Schema for AgentPayload.
 */
export const AGENT_PAYLOAD_SCHEMA = BASE_EVENT_SCHEMA.extend({
  task: z.string().default(''),
  response: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  isContinuation: z.boolean().default(false),
});

/**
 * Schema for TaskEvent.
 */
export const TASK_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  task: z.string(),
  isContinuation: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(ATTACHMENT_SCHEMA).optional(),
});

/**
 * Schema for BuildEvent.
 */
export const BUILD_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  buildId: z.string(),
  projectName: z.string().optional(),
  task: z.string().optional(),
  errorLogs: z.string().optional(),
  gapIds: z.array(z.string()).optional(),
});

/**
 * Schema for CompletionEvent.
 */
export const COMPLETION_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  agentId: z.string().default('unknown'),
  task: z.string().default(''),
  response: z.string(),
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  userNotified: z.boolean().default(false),
});

/**
 * Schema for OutboundMessageEvent.
 */
export const OUTBOUND_MESSAGE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  message: z.string(),
  agentName: z.string().default('SuperClaw'),
  memoryContexts: z.array(z.string()).default([]),
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
});

/**
 * Schema for FailureEvent.
 */
export const FAILURE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  agentId: z.string().default('unknown'),
  task: z.string().default(''),
  error: z.string(),
  userNotified: z.boolean().default(false),
});

/**
 * Schema for HealthReportEvent.
 */
export const HEALTH_REPORT_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  component: z.string(),
  issue: z.string(),
  severity: z.nativeEnum(HealthSeverity),
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for ProactiveHeartbeatPayload.
 */
export const PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA = BASE_EVENT_SCHEMA.extend({
  agentId: z.string(),
  task: z.string(),
  goalId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for the detail payload of a BridgeEvent.
 * Resolves conditional fallbacks (messageId -> traceId) during parsing.
 */
const BRIDGE_DETAIL_PAYLOAD_SCHEMA = z
  .object({
    userId: z.string().default('dashboard-user'),
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
    traceId: z.string().default('unknown'),
    agentName: z.string().default('SuperClaw'),
    message: z.string().default(''),
    isThought: z.boolean().default(false),
  })
  .passthrough()
  .transform((data) => ({
    ...data,
    // Resolve the authoritative messageId at the source
    messageId: data.messageId ?? data.traceId,
    // Pre-calculate baseUserId for the handler (in-lined to avoid circularity)
    baseUserId: data.userId.startsWith('CONV#') ? data.userId.split('#')[1] : data.userId,
  }));

/**
 * Schema for BridgeEvent, which bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 */
export const BRIDGE_EVENT_SCHEMA = z.object({
  'detail-type': z.string(),
  detail: BRIDGE_DETAIL_PAYLOAD_SCHEMA,
});
/**
 * Schema for ParallelTaskCompletedEvent.
 */
export const PARALLEL_TASK_COMPLETED_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  overallStatus: z.nativeEnum(ParallelTaskStatus),
  results: z.array(
    z.object({
      taskId: z.string(),
      agentId: z.string(),
      status: z.string(),
      result: z.string().optional().nullable(),
      error: z.string().optional().nullable(),
    })
  ),
  taskCount: z.number(),
  completedCount: z.number(),
  elapsedMs: z.number().optional(),
  aggregationType: z.enum(['summary', 'agent_guided']).optional(),
  aggregationPrompt: z.string().optional(),
});

// ============================================================================
// Typed Metadata Schemas (Structural Enforcement)
// ============================================================================
// These schemas replace the generic Record<string, unknown> metadata type
// with specific shapes for common use cases. Downstream consumers no longer
// need type assertions like `(metadata?.gapIds as string[])`.
// ============================================================================

/** Metadata schema for Coder tasks (gap tracking, build IDs). */
export const CODER_TASK_METADATA = z
  .object({
    gapIds: z.array(z.string()).default([]),
    buildId: z.string().optional(),
    targetFile: z.string().optional(),
    branch: z.string().optional(),
  })
  .default({ gapIds: [] });

/** Metadata schema for QA audit tasks. */
export const QA_AUDIT_METADATA = z
  .object({
    gapIds: z.array(z.string()).default([]),
    buildId: z.string().optional(),
    deploymentUrl: z.string().optional(),
  })
  .default({ gapIds: [] });

/** Metadata schema for Strategic Planner tasks. */
export const PLANNER_TASK_METADATA = z
  .object({
    gapId: z.string().optional(),
    category: z.string().optional(),
    priority: z.number().optional(),
  })
  .default({});

/** Metadata schema for build-related tasks. */
export const BUILD_TASK_METADATA = z
  .object({
    gapIds: z.array(z.string()).default([]),
    buildId: z.string().optional(),
    projectName: z.string().optional(),
  })
  .default({ gapIds: [] });

// Zod-inferred types for metadata schemas
export type CoderTaskMetadata = z.infer<typeof CODER_TASK_METADATA>;
export type QaAuditMetadata = z.infer<typeof QA_AUDIT_METADATA>;
export type PlannerTaskMetadata = z.infer<typeof PLANNER_TASK_METADATA>;
export type BuildTaskMetadata = z.infer<typeof BUILD_TASK_METADATA>;

// ============================================================================
// Structural Enforcement: Zod-Inferred Types (Source of Truth)
// ============================================================================
// These types are derived from the Zod schemas above, ensuring the TypeScript
// type system always matches the runtime validation behavior (including defaults
// and transformations). Use these types in handler code that calls .parse().
// The hand-written interfaces in core/lib/types/agent.ts remain for backward
// compatibility but may diverge from runtime behavior.
// ============================================================================

/** Zod-inferred type for Attachment (matches ATTACHMENT_SCHEMA runtime output). */
export type AttachmentPayload = z.infer<typeof ATTACHMENT_SCHEMA>;

/** Zod-inferred type for BaseEvent (matches BASE_EVENT_SCHEMA runtime output with defaults applied). */
export type BaseEventPayload = z.infer<typeof BASE_EVENT_SCHEMA>;

/** Zod-inferred type for AgentPayload (matches AGENT_PAYLOAD_SCHEMA runtime output). */
export type AgentPayloadInferred = z.infer<typeof AGENT_PAYLOAD_SCHEMA>;

/** Zod-inferred type for TaskEvent (matches TASK_EVENT_SCHEMA runtime output). */
export type TaskEventPayload = z.infer<typeof TASK_EVENT_SCHEMA>;

/** Zod-inferred type for BuildEvent (matches BUILD_EVENT_SCHEMA runtime output). */
export type BuildEventPayload = z.infer<typeof BUILD_EVENT_SCHEMA>;

/** Zod-inferred type for CompletionEvent (matches COMPLETION_EVENT_SCHEMA runtime output). */
export type CompletionEventPayload = z.infer<typeof COMPLETION_EVENT_SCHEMA>;

/** Zod-inferred type for OutboundMessageEvent (matches OUTBOUND_MESSAGE_EVENT_SCHEMA runtime output). */
export type OutboundMessageEventPayload = z.infer<typeof OUTBOUND_MESSAGE_EVENT_SCHEMA>;

/** Zod-inferred type for FailureEvent (matches FAILURE_EVENT_SCHEMA runtime output). */
export type FailureEventPayload = z.infer<typeof FAILURE_EVENT_SCHEMA>;

/** Zod-inferred type for HealthReportEvent (matches HEALTH_REPORT_EVENT_SCHEMA runtime output). */
export type HealthReportEventPayload = z.infer<typeof HEALTH_REPORT_EVENT_SCHEMA>;

/** Zod-inferred type for ProactiveHeartbeatPayload (matches PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA runtime output). */
export type ProactiveHeartbeatPayloadInferred = z.infer<typeof PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA>;

/** Zod-inferred type for BridgeEvent detail (matches BRIDGE_DETAIL_PAYLOAD_SCHEMA after transform). */
export type BridgeDetailPayload = z.infer<typeof BRIDGE_DETAIL_PAYLOAD_SCHEMA>;

/** Zod-inferred type for ParallelTaskCompletedEvent (matches PARALLEL_TASK_COMPLETED_EVENT_SCHEMA runtime output). */
export type ParallelTaskCompletedEventPayload = z.infer<
  typeof PARALLEL_TASK_COMPLETED_EVENT_SCHEMA
>;

/**
 * Event schema map for typed event emission and validation.
 * Maps EventType strings to their corresponding Zod schemas.
 */
export const EVENT_SCHEMA_MAP = {
  task_event: TASK_EVENT_SCHEMA,
  completion_event: COMPLETION_EVENT_SCHEMA,
  failure_event: FAILURE_EVENT_SCHEMA,
  build_event: BUILD_EVENT_SCHEMA,
  health_report_event: HEALTH_REPORT_EVENT_SCHEMA,
  outbound_message: OUTBOUND_MESSAGE_EVENT_SCHEMA,
  parallel_task_completed: PARALLEL_TASK_COMPLETED_EVENT_SCHEMA,
  heartbeat_proactive: PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA,
} as const;

/** Keys of the EVENT_SCHEMA_MAP (for type-safe event type lookups). */
export type SchemaEventType = keyof typeof EVENT_SCHEMA_MAP;
