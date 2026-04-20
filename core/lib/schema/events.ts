import { z } from 'zod';
import { AttachmentType } from '../types/llm';
import { HealthSeverity, ParallelTaskStatus } from '../types/constants';
import { EventType, AgentType } from '../types/index';
import { normalizeBaseUserId } from '../utils/normalize';

export const ATTACHMENT_SCHEMA = z
  .object({
    type: z.nativeEnum(AttachmentType),
    url: z.string().optional(),
    base64: z.string().optional(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .refine((attachment) => Boolean(attachment.url || attachment.base64), {
    message: 'Attachment must include either url or base64 payload',
  });

/**
 * Base schema for all event payloads.
 */
export const BASE_EVENT_SCHEMA = z.object({
  source: z.string().default('unknown'),
  userId: z.string().default('SYSTEM'),
  traceId: z.string().default(() => `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  taskId: z.string().default(() => `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  nodeId: z.string().optional(),
  parentId: z.string().optional(),
  agentId: z.string().optional(),
  initiatorId: z.string().default('orchestrator'),
  depth: z.number().default(0),
  sessionId: z.string().default('default-session'),
  workspaceId: z.string().optional(),
  timestamp: z.number().default(() => Date.now()),
  tokenBudget: z.number().min(0).optional(),
  costLimit: z.number().min(0).optional(),
  priorTokenUsage: z
    .object({
      inputTokens: z.number().default(0),
      outputTokens: z.number().default(0),
      totalTokens: z.number().default(0),
    })
    .optional(),
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
  failureManifest: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for CompletionEvent.
 */
export const COMPLETION_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  agentId: z.string().default('unknown'),
  task: z.string().default(''),
  response: z.string(),
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
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
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Schema for FailureEvent.
 */
export const FAILURE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  agentId: z.string().default('unknown'),
  task: z.string().default(''),
  error: z.string(),
  attachments: z.array(ATTACHMENT_SCHEMA).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
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
    workspaceId: z.string().optional(),
    collaborationId: z.string().optional(),
  })
  .passthrough()
  .transform((data) => ({
    ...data,
    // Resolve the authoritative messageId at the source
    messageId: data.messageId ?? data.traceId,
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
      patch: z.string().optional().nullable(),
    })
  ),
  taskCount: z.number(),
  completedCount: z.number(),
  elapsedMs: z.number().optional(),
  aggregationType: z.enum(['summary', 'agent_guided', 'merge_patches']).optional(),
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
    buildId: z.string().nullable().default(null),
    targetFile: z.string().nullable().default(null),
    branch: z.string().nullable().default(null),
  })
  .default({ gapIds: [], buildId: null, targetFile: null, branch: null });

/** Metadata schema for QA audit tasks. */
export const QA_AUDIT_METADATA = z
  .object({
    gapIds: z.array(z.string()).default([]),
    buildId: z.string().nullable().default(null),
    deploymentUrl: z.string().nullable().default(null),
  })
  .default({ gapIds: [], buildId: null, deploymentUrl: null });

/** Metadata schema for Strategic Planner tasks. */
export const PLANNER_TASK_METADATA = z
  .object({
    gapId: z.string().nullable().default(null),
    category: z.string().nullable().default(null),
    priority: z.number().nullable().default(null),
  })
  .default({ gapId: null, category: null, priority: null });

/** Metadata schema for build-related tasks. */
export const BUILD_TASK_METADATA = z
  .object({
    gapIds: z.array(z.string()).default([]),
    buildId: z.string().nullable().default(null),
    projectName: z.string().nullable().default(null),
  })
  .default({ gapIds: [], buildId: null, projectName: null });

/** Metadata schema for clarification requests. */
export const CLARIFICATION_TASK_METADATA = z
  .object({
    question: z.string().nullable().default(null),
    originalTask: z.string().nullable().default(null),
    retryCount: z.number().default(0),
  })
  .default({ question: null, originalTask: null, retryCount: 0 });
/** Metadata schema for research tasks. */
export const RESEARCH_TASK_METADATA = z
  .object({
    researchMode: z.enum(['evolution', 'domain']).default('domain'),
    depth: z.number().default(2),
    timeBudgetMs: z.number().optional(),
    parallel: z.boolean().default(false),
  })
  .default({ researchMode: 'domain', depth: 2, parallel: false });

// ============================================================================
// Consensus Protocol Schemas
// ============================================================================

/** Schema for consensus request events. */
export const CONSENSUS_REQUEST_SCHEMA = BASE_EVENT_SCHEMA.extend({
  proposal: z.string(),
  mode: z.enum(['majority', 'unanimous', 'weighted']).default('majority'),
  voterIds: z.array(z.string()).min(1),
  timeoutMs: z.number().default(60000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/** Schema for individual consensus vote events. */
export const CONSENSUS_VOTE_SCHEMA = BASE_EVENT_SCHEMA.extend({
  consensusId: z.string(),
  voterId: z.string(),
  vote: z.enum(['approve', 'reject', 'abstain']),
  reasoning: z.string().optional(),
  weight: z.number().default(1.0),
});

/** Schema for reputation update events. */
export const REPUTATION_UPDATE_SCHEMA = BASE_EVENT_SCHEMA.extend({
  agentId: z.string(),
  success: z.boolean(),
  durationMs: z.number(),
  error: z.string().optional(),
  taskComplexity: z.number().optional(),
});

/** Schema for parallel task dispatch events. */
export const PARALLEL_TASK_DISPATCH_SCHEMA = BASE_EVENT_SCHEMA.extend({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      agentId: z.string(),
      task: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      dependsOn: z.array(z.string()).optional(),
    })
  ),
  initialQuery: z.string().optional(),
  barrierTimeoutMs: z.number().optional(),
  aggregationType: z.enum(['summary', 'agent_guided', 'merge_patches']).optional(),
  aggregationPrompt: z.string().optional(),
});

/** Schema for consensus result events. */
export const CONSENSUS_REACHED_SCHEMA = BASE_EVENT_SCHEMA.extend({
  consensusId: z.string(),
  proposal: z.string(),
  result: z.enum(['approved', 'rejected', 'timeout']),
  mode: z.enum(['majority', 'unanimous', 'weighted']),
  approveCount: z.number(),
  rejectCount: z.number(),
  abstainCount: z.number(),
  totalVoters: z.number(),
  votes: z.array(
    z.object({
      voterId: z.string(),
      vote: z.enum(['approve', 'reject', 'abstain']),
      reasoning: z.string().optional(),
      weight: z.number(),
    })
  ),
});

/** Schema for coder task completion events. */
export const CODER_TASK_COMPLETED_SCHEMA = BASE_EVENT_SCHEMA.extend({
  task: z.string(),
  response: z.string().optional(),
  patchApplied: z.boolean().optional(),
  gapIds: z.array(z.string()).optional(),
});

/** Schema for task cancellation events. */
export const TASK_CANCELLED_SCHEMA = BASE_EVENT_SCHEMA.extend({
  reason: z.string().optional(),
  parallelDispatchId: z.string().optional(),
});

/** Schema for human handoff events. */
export const HANDOFF_SCHEMA = BASE_EVENT_SCHEMA.extend({
  handoffType: z.enum(['approval', 'clarification', 'escalation']),
  message: z.string().optional(),
  expiresAt: z.number().optional(),
});

/** Schema for escalation level timeout events from the scheduler. */
export const ESCALATION_LEVEL_TIMEOUT_SCHEMA = z.object({
  traceId: z.string(),
  agentId: z.string(),
  userId: z.string(),
  question: z.string().optional(),
  originalTask: z.string().optional(),
  currentLevel: z.number(),
  policyId: z.string(),
});

/** Schema for escalation completed events. */
export const ESCALATION_COMPLETED_SCHEMA = z.object({
  traceId: z.string(),
  agentId: z.string(),
  userId: z.string(),
  outcome: z.enum(['resolved', 'escalated_to_human', 'abandoned']),
  resolution: z.string().optional(),
});

// Zod-inferred types for metadata schemas
export type CoderTaskMetadata = z.infer<typeof CODER_TASK_METADATA>;
export type QaAuditMetadata = z.infer<typeof QA_AUDIT_METADATA>;
export type PlannerTaskMetadata = z.infer<typeof PLANNER_TASK_METADATA>;
export type BuildTaskMetadata = z.infer<typeof BUILD_TASK_METADATA>;
export type ClarificationTaskMetadata = z.infer<typeof CLARIFICATION_TASK_METADATA>;

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

export const PARALLEL_BARRIER_TIMEOUT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  barrierId: z.string(),
  traceId: z.string(),
  timedOutTasks: z.array(z.string()),
});

export const ORCHESTRATION_SIGNAL_SCHEMA = z.object({
  traceId: z.string(),
  agentId: z.string(),
  signal: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DLQ_ROUTE_SCHEMA = BASE_EVENT_SCHEMA.extend({
  eventCategory: z.string().default('dlq_routing'),
  detailType: z.string(),
  originalEvent: z.record(z.string(), z.unknown()),
  envelopeId: z.string().optional(),
  errorMessage: z.string().optional(),
  retryCount: z.number().default(0),
});

/** Schema for pulse check events. */
export const PULSE_EVENT_SCHEMA = BASE_EVENT_SCHEMA.extend({
  targetAgentId: z.string(),
  timestamp: z.number(),
  responseTimestamp: z.number().optional(),
  status: z.enum(['ping', 'pong']).default('ping'),
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
  [`${AgentType.STRATEGIC_PLANNER}_task`]: TASK_EVENT_SCHEMA,
  [`${AgentType.COGNITION_REFLECTOR}_task`]: TASK_EVENT_SCHEMA,
  [`${AgentType.QA}_task`]: TASK_EVENT_SCHEMA,
  [`${AgentType.CRITIC}_task`]: TASK_EVENT_SCHEMA,
  [`${AgentType.FACILITATOR}_task`]: TASK_EVENT_SCHEMA,
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
  [`${AgentType.RESEARCHER}_task`]: TASK_EVENT_SCHEMA,
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
  `${AgentType.STRATEGIC_PLANNER}_task`,
  `${AgentType.COGNITION_REFLECTOR}_task`,
  `${AgentType.QA}_task`,
  `${AgentType.CRITIC}_task`,
  `${AgentType.FACILITATOR}_task`,
  `${AgentType.RESEARCHER}_task`,
] as const;

export type AgentTaskEventType = (typeof AGENT_TASK_EVENT_TYPES)[number];
