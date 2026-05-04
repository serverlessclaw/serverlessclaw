import { z } from 'zod';
import { HealthSeverity } from '../types/constants';
import { EventType, AGENT_TYPES } from '../types/index';
import { normalizeBaseUserId } from '../utils/normalize';
import { generateMessageId } from '../utils/id-generator';

import { BASE_EVENT_SCHEMA, ATTACHMENT_SCHEMA } from './events/base';
import {
  CONSENSUS_REQUEST_SCHEMA,
  CONSENSUS_VOTE_SCHEMA,
  CONSENSUS_REACHED_SCHEMA,
  REPUTATION_UPDATE_SCHEMA,
} from './events/protocol';
import {
  PARALLEL_TASK_DISPATCH_SCHEMA,
  PARALLEL_TASK_COMPLETED_EVENT_SCHEMA,
  PARALLEL_BARRIER_TIMEOUT_SCHEMA,
} from './events/parallel';

export * from './events/base';
export * from './events/metadata';
export * from './events/protocol';
export * from './events/parallel';

/**
 * Schema for AgentPayload.
 * Standardized payload for most agent-to-agent communication.
 */
export const AGENT_PAYLOAD_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Primary task description. */
  task: z.string().default(''),
  /** Optional completion response. */
  response: z.string().optional(),
  /** Extensible metadata record. */
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** Array of associated attachments. */
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  /** Flag indicating if this task is a continuation. */
  isContinuation: z.boolean().default(false),
});

/**
 * Schema for TaskEvent.
 * Lightweight wrapper for task assignments.
 */
export const TASK_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Task description. */
  task: z.string(),
  /** Flag indicating if this task is a continuation. */
  isContinuation: z.boolean().optional(),
  /** Task-specific metadata. */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Task-specific attachments. */
  attachments: z.array(ATTACHMENT_SCHEMA).optional(),
});

/**
 * Schema for BuildEvent.
 * Tracking for infrastructure and code builds.
 */
export const BUILD_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Unique identifier for the build job. */
  buildId: z.string(),
  /** Name of the project being built. */
  projectName: z.string().optional(),
  /** Associated task description. */
  task: z.string().optional(),
  /** Truncated error logs for failure analysis. */
  errorLogs: z.string().optional(),
  /** GAPs being addressed by this build. */
  gapIds: z.array(z.string()).optional(),
  /** Structured failure manifest. */
  failureManifest: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for CompletionEvent.
 * Emitted when an agent completes its primary task.
 */
export const COMPLETION_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the completing agent. */
  agentId: z.string().default('unknown'),
  /** Original task description. */
  task: z.string().default(''),
  /** The final response or result. */
  response: z.string(),
  /** Results attachments. */
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  /** Final metadata. */
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** Whether the user has already been notified. */
  userNotified: z.boolean().default(false),
});

/**
 * Schema for OutboundMessageEvent.
 * Direct communication to the user.
 */
export const OUTBOUND_MESSAGE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** The message text. */
  message: z.string(),
  /** Display name of the sender. */
  agentName: z.string().default('SuperClaw'),
  /** Context identifiers used to generate the message. */
  memoryContexts: z.array(z.string()).default([]),
  /** Message attachments. */
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  /** Message-specific metadata. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Schema for FailureEvent.
 * Standardized error reporting across agents.
 */
export const FAILURE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the failing agent. */
  agentId: z.string().default('unknown'),
  /** Description of the task that failed. */
  task: z.string().default(''),
  /** Error message or stack trace. */
  error: z.string(),
  /** Failure context attachments. */
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  /** Error-specific metadata. */
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** Whether the user has already been notified. */
  userNotified: z.boolean().default(false),
});

/**
 * Schema for HealthReportEvent.
 * Component-level health monitoring.
 */
export const HEALTH_REPORT_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Component name (e.g. "Lambda", "DynamoDB"). */
  component: z.string(),
  /** Description of the health issue. */
  issue: z.string(),
  /** Severity level. */
  severity: z.nativeEnum(HealthSeverity),
  /** Additional diagnostic context. */
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for ProactiveHeartbeatPayload.
 */
export const PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the agent. */
  agentId: z.string(),
  /** Current task being worked on. */
  task: z.string(),
  /** Active goal identifier. */
  goalId: z.string(),
  /** Heartbeat metadata. */
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
    workspaceId: z.string().optional(),
    orgId: z.string().optional(),
    teamId: z.string().optional(),
    staffId: z.string().optional(),
    collaborationId: z.string().optional(),
  })
  .passthrough()
  .transform((data) => ({
    ...data,
    // Resolve the authoritative messageId at the source
    messageId: data.messageId || data.traceId || generateMessageId('pending'),
    // Pre-calculate baseUserId for the handler
    baseUserId: normalizeBaseUserId(data.userId),
  }));

/**
 * Schema for BridgeEvent, which bridges AgentBus (EventBridge) to RealtimeBus (IoT Core).
 */
export const BRIDGE_EVENT_SCHEMA = z.object({
  'detail-type': z.string(),
  detail: BRIDGE_DETAIL_PAYLOAD_SCHEMA,
});

/** Schema for coder task completion events. */
export const CODER_TASK_COMPLETED_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Original task description. */
  task: z.string(),
  /** Optional final response. */
  response: z.string().optional(),
  /** Whether the suggested patch was applied. */
  patchApplied: z.boolean().optional(),
  /** GAPs addressed by the coder. */
  gapIds: z.array(z.string()).optional(),
});

/** Schema for task cancellation events. */
export const TASK_CANCELLED_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Reason for cancellation. */
  reason: z.string().optional(),
  /** Identifier of the parallel dispatch that was cancelled. */
  parallelDispatchId: z.string().optional(),
});

/**
 * Schema for human handoff events.
 */
export const HANDOFF_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Type of handoff (approval, clarification, or full escalation). */
  handoffType: z.enum(['approval', 'clarification', 'escalation']),
  /** Human-readable message explaining the handoff. */
  message: z.string().optional(),
  /** Optional epoch timestamp when the handoff request expires. */
  expiresAt: z.number().optional(),
});

/**
 * Schema for escalation level timeout events from the scheduler.
 */
export const ESCALATION_LEVEL_TIMEOUT_SCHEMA = z.object({
  /** Trace ID for correlation. */
  traceId: z.string(),
  /** Identifier of the agent being escalated. */
  agentId: z.string(),
  /** User ID associated with the task. */
  userId: z.string(),
  /** Original question or task description. */
  question: z.string().optional(),
  /** Original task. */
  originalTask: z.string().optional(),
  /** Current escalation level (1-indexed). */
  currentLevel: z.number(),
  /** Policy identifier for rule lookup. */
  policyId: z.string(),
});

/**
 * Schema for escalation completed events.
 */
export const ESCALATION_COMPLETED_SCHEMA = z.object({
  /** Trace ID for correlation. */
  traceId: z.string(),
  /** Identifier of the escalated agent. */
  agentId: z.string(),
  /** User ID associated with the task. */
  userId: z.string(),
  /** Final outcome of the escalation process. */
  outcome: z.enum(['resolved', 'escalated_to_human', 'abandoned']),
  /** Final resolution text or summary. */
  resolution: z.string().optional(),
});

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

/** Schema for DLQ routing events. */
export const DLQ_ROUTE_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Category of the event for routing. */
  eventCategory: z.string().default('dlq_routing'),
  /** Original detail type. */
  detailType: z.string(),
  /** The full original event payload. */
  originalEvent: z.record(z.string(), z.unknown()),
  /** Envelope identifier. */
  envelopeId: z.string().optional(),
  /** Error that caused DLQ routing. */
  errorMessage: z.string().optional(),
  /** Current retry count. */
  retryCount: z.number().default(0),
});

/** Schema for pulse check events. */
export const PULSE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Target agent for the pulse check. */
  targetAgentId: z.string(),
  /** Ping timestamp. */
  timestamp: z.number(),
  /** Pong timestamp. */
  responseTimestamp: z.number().optional(),
  /** Pulse status. */
  status: z.enum(['ping', 'pong']).default('ping'),
});

/** Schema for orchestration signals. */
export const ORCHESTRATION_SIGNAL_SCHEMA = z.object({
  /** Trace ID for correlation. */
  traceId: z.string(),
  /** Identifier of the agent receiving the signal. */
  agentId: z.string(),
  /** The signal command. */
  signal: z.string(),
  /** Optional signal metadata. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Event schema map for typed event emission and validation.
 * Maps EventType strings to their corresponding Zod schemas.
 */
export const EVENT_SCHEMA_MAP = {
  [EventType.CODER_TASK as string]: TASK_EVENT_SCHEMA,
  [EventType.CONTINUATION_TASK as string]: TASK_EVENT_SCHEMA,
  [EventType.REFLECT_TASK as string]: TASK_EVENT_SCHEMA,
  [EventType.EVOLUTION_PLAN as string]: TASK_EVENT_SCHEMA,
  [EventType.MONITOR_BUILD as string]: TASK_EVENT_SCHEMA,
  [EventType.TASK_COMPLETED as string]: COMPLETION_EVENT_SCHEMA,
  [EventType.TASK_FAILED as string]: FAILURE_EVENT_SCHEMA,
  [EventType.SYSTEM_BUILD_SUCCESS as string]: BUILD_EVENT_SCHEMA,
  [EventType.SYSTEM_BUILD_FAILED as string]: BUILD_EVENT_SCHEMA,
  [EventType.SYSTEM_HEALTH_REPORT as string]: HEALTH_REPORT_EVENT_SCHEMA,
  [EventType.OUTBOUND_MESSAGE as string]: OUTBOUND_MESSAGE_EVENT_SCHEMA,
  [EventType.PARALLEL_TASK_COMPLETED as string]: PARALLEL_TASK_COMPLETED_EVENT_SCHEMA,
  [EventType.HEARTBEAT_PROACTIVE as string]: PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA,
  [`${AGENT_TYPES.STRATEGIC_PLANNER}_task`]: TASK_EVENT_SCHEMA,
  [`${AGENT_TYPES.COGNITION_REFLECTOR}_task`]: TASK_EVENT_SCHEMA,
  [`${AGENT_TYPES.QA}_task`]: TASK_EVENT_SCHEMA,
  [`${AGENT_TYPES.CRITIC}_task`]: TASK_EVENT_SCHEMA,
  [`${AGENT_TYPES.FACILITATOR}_task`]: TASK_EVENT_SCHEMA,
  [EventType.CONSENSUS_REQUEST as string]: CONSENSUS_REQUEST_SCHEMA,
  [EventType.CONSENSUS_VOTE as string]: CONSENSUS_VOTE_SCHEMA,
  [EventType.CONSENSUS_REACHED as string]: CONSENSUS_REACHED_SCHEMA,
  [EventType.HEALTH_ALERT as string]: HEALTH_REPORT_EVENT_SCHEMA,
  [EventType.REPUTATION_UPDATE as string]: REPUTATION_UPDATE_SCHEMA,
  [EventType.PARALLEL_TASK_DISPATCH as string]: PARALLEL_TASK_DISPATCH_SCHEMA,
  [EventType.CODER_TASK_COMPLETED as string]: CODER_TASK_COMPLETED_SCHEMA,
  [EventType.TASK_CANCELLED as string]: TASK_CANCELLED_SCHEMA,
  [EventType.HANDOFF as string]: HANDOFF_SCHEMA,
  [EventType.RECOVERY_LOG as string]: TASK_EVENT_SCHEMA,
  [EventType.CLARIFICATION_REQUEST as string]: TASK_EVENT_SCHEMA,
  [EventType.CLARIFICATION_TIMEOUT as string]: TASK_EVENT_SCHEMA,
  [EventType.SCHEDULE_TASK as string]: TASK_EVENT_SCHEMA,
  [EventType.CHUNK as string]: z.object({ content: z.string() }).passthrough(),
  [`${AGENT_TYPES.RESEARCHER}_task`]: TASK_EVENT_SCHEMA,
  [EventType.RESEARCH_TASK as string]: TASK_EVENT_SCHEMA,
  [EventType.MERGER_TASK as string]: TASK_EVENT_SCHEMA,
  [EventType.COGNITIVE_HEALTH_CHECK as string]: TASK_EVENT_SCHEMA,
  [EventType.ESCALATION_LEVEL_TIMEOUT as string]: ESCALATION_LEVEL_TIMEOUT_SCHEMA,
  [EventType.PARALLEL_BARRIER_TIMEOUT as string]: PARALLEL_BARRIER_TIMEOUT_SCHEMA,
  [EventType.ORCHESTRATION_SIGNAL as string]: ORCHESTRATION_SIGNAL_SCHEMA,
  [EventType.DASHBOARD_FAILURE_DETECTED as string]: FAILURE_EVENT_SCHEMA,
  [EventType.DLQ_ROUTE as string]: DLQ_ROUTE_SCHEMA,
  [EventType.PULSE_PING as string]: PULSE_EVENT_SCHEMA,
  [EventType.PULSE_PONG as string]: PULSE_EVENT_SCHEMA,
} as const;

/** Keys of the EVENT_SCHEMA_MAP (for type-safe event type lookups). */
export type SchemaEventType = keyof typeof EVENT_SCHEMA_MAP;

/** Agent task event type strings (for use with validateEventPayload). */
export const AGENT_TASK_EVENT_TYPES = [
  `${AGENT_TYPES.STRATEGIC_PLANNER}_task`,
  `${AGENT_TYPES.COGNITION_REFLECTOR}_task`,
  `${AGENT_TYPES.QA}_task`,
  `${AGENT_TYPES.CRITIC}_task`,
  `${AGENT_TYPES.FACILITATOR}_task`,
  `${AGENT_TYPES.RESEARCHER}_task`,
] as const;

export type AgentTaskEventType = (typeof AGENT_TASK_EVENT_TYPES)[number];
