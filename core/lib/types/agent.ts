/**
 * @module AgentTypes
 * Core type definitions for the agent swarm, including events, payloads, and lifecycle states.
 */
import type {
  BaseEventPayload,
  AgentPayloadInferred,
  TaskEventPayload,
  BuildEventPayload,
  CompletionEventPayload,
  OutboundMessageEventPayload,
  FailureEventPayload,
  HealthReportEventPayload,
  ProactiveHeartbeatPayloadInferred,
} from '../schema/events';

import { Attachment, isValidAttachment } from './llm';

export { isValidAttachment };
export type { Attachment };
export type BaseEvent = BaseEventPayload;
export type AgentPayload = AgentPayloadInferred;
export type TaskEvent = TaskEventPayload;
export type BuildEvent = BuildEventPayload;
export type CompletionEvent = CompletionEventPayload;
export type OutboundMessageEvent = OutboundMessageEventPayload;
export type FailureEvent = FailureEventPayload;
export type HealthReportEvent = HealthReportEventPayload;
export type ProactiveHeartbeatPayload = ProactiveHeartbeatPayloadInferred;

/**
 * Event routing configuration for dynamic dispatch.
 */
export interface EventRoutingEntry {
  /** The module path relative to 'core/handlers/'. */
  module: string;
  /** The exported function name to handle the event. */
  function: string;
  /** Whether to pass the AWS Lambda context to the handler. */
  passContext?: boolean;
}

/**
 * Map of EventType identifiers to routing entries.
 */
export type EventRoutingTable = Record<string, EventRoutingEntry>;

/**
 * Shared EventBridge event structure for agent handlers.
 */
export interface AgentEvent {
  /** The structured detail of the event. */
  detail: AgentPayload; // required: events must carry payload
  /** The source of the event (e.g., 'core.superclaw'). */
  source: string; // tightened: source should always be known
}

/**
 * Categorization of agents to guide orchestration.
 */
export enum AgentCategory {
  /** General purpose agents for user-facing tasks. */
  SOCIAL = 'social',
  /** Specialized nodes for system evolution and maintenance. */
  SYSTEM = 'system',
}

/**
 * Safety tiers for agent trust levels.
 * - local: Local development environment, full access for testing.
 * - prod: Production environment, strict safety and approval gates.
 */
export enum SafetyTier {
  LOCAL = 'local',
  PROD = 'prod',
}

/** Common resource connection profiles. */
export enum ConnectionProfile {
  BUS = 'bus',
  MEMORY = 'memory',
  STORAGE = 'storage',
  CODEBUILD = 'codebuild',
  CONFIG = 'config',
  TRACE = 'trace',
  KNOWLEDGE = 'knowledge',
  DEPLOYER = 'deployer',
  MEMORY_TABLE = 'memoryTable',
}

/**
 * Event source identifiers for tracking event origins.
 * Used in EventBridge source field and agent tracing.
 */
export enum EventSource {
  DASHBOARD = 'dashboard',
  TELEGRAM = 'telegram',
  API = 'api',
  SYSTEM = 'system',
  CODEBUILD = 'codebuild',
  SCHEDULER = 'scheduler',
  ORCHESTRATOR = 'orchestrator',
  WARMUP_MANAGER = 'warmup-manager',
  AGENT = 'agent',
  PARALLEL = 'parallel',
  SUPERCLAW = 'superclaw',
  AGENT_CRITIC = 'agent.critic',
  AGENT_RESEARCHER = 'agent.researcher',
  AGENT_FACILITATOR = 'agent.facilitator',
  BATCH_EVOLUTION = 'batch_evolution',
  HEARTBEAT_SCHEDULER = 'heartbeat.scheduler',
  CORE_RECOVERY = 'core.recovery',
  WEBHOOK = 'webhook',
  UNKNOWN = 'unknown',
}

/**
 * Priority levels for tasks, events, and metadata.
 */
export enum PriorityLevel {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/**
 * Safety action types for evaluation by the safety engine.
 */
export enum SafetyActionType {
  DEPLOYMENT = 'deployment',
  CODE_CHANGE = 'code_change',
  FILE_OPERATION = 'file_operation',
  SHELL_COMMAND = 'shell_command',
  MCP_TOOL = 'mcp_tool',
  IAM_CHANGE = 'iam_change',
  INFRA_TOPOLOGY = 'infra_topology',
  ANY = 'any',
}

/**
 * Configuration interface for an Agent, defining its identity,
 * capabilities, and preferred reasoning behavior.
 */
export interface IAgentConfig {
  /** Unique ID of the agent. */
  id: string;
  /** Human-readable name of the agent. */
  name: string;
  /** The core system prompt defining personality and rules. */
  systemPrompt: string;
  /** Localized system prompts */
  systemPrompts?: { en: string; cn: string };
  /** Detailed description of the agent's purpose. */
  description?: string;
  /** Categorization for orchestration gating. */
  category?: AgentCategory;
  /** Icon name for UI representation. */
  icon?: string;
  /** Specific LLM model ID override. */
  model?: string;
  /** Preferred reasoning profile (FAST, STANDARD, THINKING, DEEP). */
  reasoningProfile?: import('./llm').ReasoningProfile;
  /** Specific LLM provider name override. */
  provider?: string;
  /** List of tool names assigned to this agent. */
  tools?: string[];
  /** Whether the agent is currently active. */
  enabled: boolean;
  /** Whether this is a hardcoded system agent (cannot be deleted). */
  isBackbone?: boolean;
  /** Resource connections for the agent (e.g., 'bus', 'memory'). */
  connectionProfile?: (ConnectionProfile | string)[];
  /** Maximum tool execution loops allowed in a single turn. */
  maxIterations?: number;
  /** Whether the agent can call multiple tools in parallel. */
  parallelToolCalls?: boolean;
  /** Default communication style (JSON for system, Text for human). */
  defaultCommunicationMode?: 'json' | 'text';
  /** MCP server ARN mappings for tool execution. */
  mcpServers?: Record<string, string>;
  /** Sampling temperature (0.0 to 1.0). Controls randomness. */
  temperature?: number;
  /** Maximum tokens for the completion. */
  maxTokens?: number;
  /** Nucleus sampling probability (0.0 to 1.0). */
  topP?: number;
  /** Sequences where the LLM will stop generating. */
  stopSequences?: string[];
  /** Explicit UI metadata overrides for topology visualization. */
  topologyOverride?: {
    label?: string;
    icon?: string;
    tier?: 'APP' | 'COMM' | 'AGENT' | 'INFRA';
  };
  /** Safety trust level for this agent. Controls approval gates. */
  safetyTier?: SafetyTier;
  /** Operational mode for system evolution and resource access approvals. */
  evolutionMode?: EvolutionMode;
  /** Token budget constraint for this agent. */
  tokenBudget?: number;
  /** Maximum cost allowed for this agent (USD). */
  costLimit?: number;
  /** Current trust score (0-100) based on cognitive health performance. */
  trustScore?: number;
  /** Whether this agent has been manually approved for protected resource access. */
  manuallyApproved?: boolean;
}

/**
 * Metadata for a dynamically installed skill with optional TTL.
 */
export interface InstalledSkill {
  /** The name of the tool/skill. */
  name: string;
  /** Unix timestamp (ms) when the skill expires. */
  expiresAt?: number;
}

/**
 * Predefined agent role types.
 */
export enum AgentType {
  /** The primary manager agent. */
  SUPERCLAW = 'superclaw',
  /** Specialized coding and refactoring agent. */
  CODER = 'coder',
  /** Background agent for monitoring builds and deployments. */
  BUILD_MONITOR = 'monitor',
  /** Event processing agent for system-wide signals. */
  EVENT_HANDLER = 'events',
  /** Self-healing and automated rollback agent. */
  RECOVERY = 'recovery',
  /** Long-term planning and architectural agent. */
  STRATEGIC_PLANNER = 'strategic-planner',
  /** Reflective agent for distilling knowledge and lessons. */
  COGNITION_REFLECTOR = 'cognition-reflector',
  /** Quality assurance and automated testing agent. */
  QA = 'qa',
  /** Peer review agent for Council of Agents. */
  CRITIC = 'critic',
  /** Dedicated moderator for multi-party collaborations. */
  FACILITATOR = 'facilitator',
  /** Specialized agent for semantic multi-track code merging. */
  MERGER = 'merger',
  /** Specialized agent for technical research and pattern discovery. */
  RESEARCHER = 'researcher',
  /** Dedicated impartial judge for semantic evaluation and trust calibration. */
  JUDGE = 'judge',
}

/**
 * Origin of a request or task.
 */
export enum TraceSource {
  DASHBOARD = 'dashboard',
  TELEGRAM = 'telegram',
  API = 'api',
  SYSTEM = 'system',
  UNKNOWN = 'unknown',
}

/**
 * Standard system event types for communication between agents.
 */
export enum EventType {
  /** Request for code modification. */
  CODER_TASK = 'coder_task',
  /** Completion signal for a coding task. */
  CODER_TASK_COMPLETED = 'coder_task_completed',
  /** Signal that a system deployment failed. */
  SYSTEM_BUILD_FAILED = 'system_build_failed',
  /** Signal that a system deployment succeeded. */
  SYSTEM_BUILD_SUCCESS = 'system_build_success',
  /** Periodic build status update. */
  MONITOR_BUILD = 'monitor_build',
  /** Audit log for recovery operations. */
  RECOVERY_LOG = 'recovery_log',
  /** Proposal for system capability improvement. */
  EVOLUTION_PLAN = 'evolution_plan',
  /** Request for session reflection and distillation. */
  REFLECT_TASK = 'reflect_task',
  /** Message destined for an external channel (e.g., Slack). */
  OUTBOUND_MESSAGE = 'outbound_message',
  /** Signal to resume a complex task in a new execution context. */
  CONTINUATION_TASK = 'continuation_task',
  /** Generic task completion signal. */
  TASK_COMPLETED = 'task_completed',
  /** Generic task failure signal. */
  TASK_FAILED = 'task_failed',
  /** Event emitted when an agent detects an internal health issue. */
  SYSTEM_HEALTH_REPORT = 'system_health_report',
  /** Request for clarification from an initiator agent. */
  CLARIFICATION_REQUEST = 'clarification_request',
  /** Timeout signal for a clarification request that was not answered. */
  CLARIFICATION_TIMEOUT = 'clarification_timeout',
  /** Request to schedule a future task or heartbeat. */
  SCHEDULE_TASK = 'schedule_task',
  /** Proactive heartbeat signal indicating a scheduled goal or task activation. */
  HEARTBEAT_PROACTIVE = 'heartbeat_proactive',
  /** Request to cancel an in-flight task. */
  TASK_CANCELLED = 'task_cancelled',
  /** Request to dispatch multiple tasks in parallel. */
  PARALLEL_TASK_DISPATCH = 'parallel_task_dispatch',
  /** Parallel task completion with aggregated results. */
  PARALLEL_TASK_COMPLETED = 'parallel_task_completed',
  /** Parallel task barrier timeout - straggler tasks should be marked as timed out. */
  PARALLEL_BARRIER_TIMEOUT = 'parallel_barrier_timeout',
  /** Signal that a specific task in a DAG execution has completed. */
  DAG_TASK_COMPLETED = 'dag_task_completed',
  /** Signal that a specific task in a DAG execution has failed. */
  DAG_TASK_FAILED = 'dag_task_failed',
  /** Real-time message chunk for streaming responses (Legacy). */
  CHUNK = 'chunk',

  // --- AG-UI Protocol Standard Events ---
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_ERROR = 'RUN_ERROR',
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',
  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  TOOL_CALL_END = 'TOOL_CALL_END',
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  STATE_DELTA = 'STATE_DELTA',
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',

  /** Request for peer review by the Critic Agent (Council of Agents). */
  CRITIC_TASK = 'critic_task',
  /** Event emitted when an agent reputation is updated. */
  REPUTATION_UPDATE = 'reputation_update',
  /** Request for swarm consensus on a high-impact change. */
  CONSENSUS_REQUEST = 'consensus_request',
  /** A vote submitted by a peer for a consensus request. */
  CONSENSUS_VOTE = 'consensus_vote',
  /** Event emitted when consensus has been reached. */
  CONSENSUS_REACHED = 'consensus_reached',
  /** Escalation level timeout event. */
  ESCALATION_LEVEL_TIMEOUT = 'escalation_level_timeout',
  /** Escalation completed event. */
  ESCALATION_COMPLETED = 'escalation_completed',
  /** Event emitted when a human participant takes control. */
  HANDOFF = 'handoff',
  /** Critical system-wide health alert (e.g., EventBus down). */
  HEALTH_ALERT = 'health_alert',
  /** Periodic cognitive health check for agent reasoning quality. */
  COGNITIVE_HEALTH_CHECK = 'cognitive_health_check',
  /** Request for technical research and pattern discovery. */
  RESEARCH_TASK = 'research_task',
  /** Request for AST-aware patch reconciliation by Merger Agent. */
  MERGER_TASK = 'merger_task',
  /** Request for facilitation of multi-agent coordination and consensus. */
  FACILITATOR_TASK = 'facilitator_task',
  /** Request for QA verification and test execution. */
  QA_TASK = 'qa_task',
  /** Request for cognitive reflection and context distillation. */
  COGNITION_REFLECTOR_TASK = 'cognition_reflector_task',
  /** Request for strategic planning and roadmap generation. */
  STRATEGIC_PLANNER_TASK = 'strategic_planner_task',
  /** High-level orchestration signal for automated state transitions. */
  ORCHESTRATION_SIGNAL = 'orchestration_signal',
  /** Event emitted when a strategic tie-break is performed after a timeout. */
  STRATEGIC_TIE_BREAK = 'strategic_tie_break',
  /** Event for retroactive report-back after an autonomous action. */
  REPORT_BACK = 'report_back',
  /** User request delegated to specialized agent (from SuperClaw). */
  DELEGATION_TASK = 'delegation_task',
  /** Trigger for system audit based on code growth threshold or event. */
  SYSTEM_AUDIT_TRIGGER = 'system_audit_trigger',
  /** Route an event to the Dead Letter Queue. */
  DLQ_ROUTE = 'dlq_route',
}

/**
 * Operational modes for system evolution.
 */
export enum EvolutionMode {
  /** Autonomous improvement without human intervention. */
  AUTO = 'auto',
  /** Requires human approval for proposed changes. */
  HITL = 'hitl',
}

/**
 * Evolution tracks for parallel multi-track evolution.
 * Each track focuses on a different aspect of system improvement.
 */
export enum EvolutionTrack {
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  FEATURE = 'feature',
  INFRASTRUCTURE = 'infrastructure',
  REFACTORING = 'refactoring',
}

/** Track configuration for parallel evolution. */
export interface TrackConfig {
  track: EvolutionTrack;
  /** Maximum concurrent gaps in this track. */
  maxConcurrentGaps: number;
  /** Dispatch priority (lower = higher priority). */
  priority: number;
  /** Whether this track is active. */
  enabled: boolean;
}

/** Gap-to-track assignment metadata. */
export interface GapTrackAssignment {
  gapId: string;
  track: EvolutionTrack;
  assignedAt: number;
  priority: number;
}

/**
 * Lifecycle stages for identified capability gaps.
 */
export enum GapStatus {
  /** Initial identification. */
  OPEN = 'OPEN',
  /** Targeted for future development. */
  PLANNED = 'PLANNED',
  /** Currently being addressed by an agent. */
  PROGRESS = 'PROGRESS',
  /** Fix has been deployed but not fully verified. */
  DEPLOYED = 'DEPLOYED',
  /** Gap successfully closed. */
  DONE = 'DONE',
  /** Attempt to close gap failed. */
  FAILED = 'FAILED',
  /** Ignored or superseded. */
  ARCHIVED = 'ARCHIVED',
  /** Awaiting human approval in HITL mode. */
  PENDING_APPROVAL = 'PENDING_APPROVAL',
}

/**
 * Result of a gap status transition attempt.
 */
export interface GapTransitionResult {
  success: boolean;
  currentStatus?: GapStatus;
  error?: string;
}

/**
 * Standardized execution status for autonomous agents.
 */
export enum AgentStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CONTINUE = 'CONTINUE',
  REOPEN = 'REOPEN',
  RETRY = 'RETRY',
  PIVOT = 'PIVOT',
  ESCALATE = 'ESCALATE',
}

/**
 * Structured output signal for agent orchestration, often returned in JSON mode.
 * Guided by the Standard Signal Schema for deterministic state transitions.
 */
export interface AgentSignal {
  /** Final operational status of the agent task. */
  status: AgentStatus;
  /** List of gap IDs that this task has addressed or closed. */
  coveredGapIds?: string[];
  /** Optional ID of a build or deployment triggered during execution. */
  buildId?: string;
  /** Inner monologue or reasoning steps explaining the result. */
  reasoning: string;
}

/**
 * Individual issue identified during QA audit feedback.
 */
export interface QAFailureIssue {
  /** File path where the issue was found. */
  file: string;
  /** Line number of the issue (1-indexed). */
  line: number;
  /** Clear explanation of what failed. */
  description: string;
  /** What should happen (expected behavior). */
  expected: string;
  /** What actually happened (actual behavior). */
  actual: string;
}

/**
 * Structured feedback block returned by QA Auditor on REOPEN status.
 * Machine-readable format enabling Coder Agent to parse and fix issues autonomously.
 */
export interface QAFailureFeedback {
  /** Type of failure: logic error, missing test, docs drift, or security risk. */
  failureType: 'LOGIC_ERROR' | 'MISSING_TEST' | 'DOCS_DRIFT' | 'SECURITY_RISK';
  /** List of specific issues found during audit. */
  issues: QAFailureIssue[];
}

/**
 * Generic interface for communication channels (Telegram, Slack, IoT).
 */
export interface IChannel {
  /**
   * Sends a message to a specific user via the channel's protocol.
   * @param userId The recipient's channel-specific ID.
   * @param text The message content.
   */
  send(userId: string, text: string): Promise<void>;
}

/**
 * Granular safety policy defining rules for a specific safety tier.
 */
export interface SafetyPolicy {
  /** The safety tier this policy applies to. */
  tier: SafetyTier;
  /** Whether code changes require approval. */
  requireCodeApproval: boolean;
  /** Whether deployments require approval. */
  requireDeployApproval: boolean;
  /** Whether file operations require approval. */
  requireFileApproval: boolean;
  /** Whether shell commands require approval. */
  requireShellApproval: boolean;
  /** Whether MCP tool calls require approval. */
  requireMcpApproval: boolean;
  /** List of allowed file paths (glob patterns). */
  allowedFilePaths?: string[];
  /** List of blocked file paths (glob patterns). */
  blockedFilePaths?: string[];
  /** List of allowed API endpoints/domains. */
  allowedApiEndpoints?: string[];
  /** List of blocked API endpoints/domains. */
  blockedApiEndpoints?: string[];
  /** Maximum deployments per day. */
  maxDeploymentsPerDay?: number;
  /** Maximum shell commands per hour. */
  maxShellCommandsPerHour?: number;
  /** Maximum file writes per hour. */
  maxFileWritesPerHour?: number;
  /** Cognitive metric thresholds for anomaly detection. */
  cognitiveThresholds?: {
    minCompletionRate?: number;
    maxErrorRate?: number;
    minCoherence?: number;
    maxMissRate?: number;
    maxAvgLatencyMs?: number;
    maxPivotRate?: number;
    minSampleTasks?: number;
  };
  /** Time-based restrictions. */
  timeRestrictions?: TimeRestriction[];
}

/**
 * Time-based restriction window.
 */
export interface TimeRestriction {
  /** Days of week (0 = Sunday, 6 = Saturday). */
  daysOfWeek: number[];
  /** Start hour (0-23). */
  startHour: number;
  /** End hour (0-23). */
  endHour: number;
  /** Timezone (e.g., 'America/New_York'). */
  timezone: string;
  /** Actions restricted during this window. */
  restrictedActions: string[];
  /** Whether to block or require approval during restriction. */
  restrictionType: 'block' | 'require_approval';
}

/**
 * Safety violation record for logging and reporting.
 */
export interface SafetyViolation {
  /** Unique violation ID. */
  id: string;
  /** Timestamp of the violation. */
  timestamp: Date;
  /** Agent that triggered the violation. */
  agentId: string;
  /** Safety tier of the agent. */
  safetyTier: SafetyTier;
  /** Action that was attempted. */
  action: string;
  /** Tool involved (if any). */
  toolName?: string;
  /** Resource involved (file path, API endpoint, etc.). */
  resource?: string;
  /** Reason for the violation. */
  reason: string;
  /** Whether the action was blocked or required approval. */
  outcome: 'blocked' | 'approval_required' | 'allowed';
  /** Session/trace ID for correlation. */
  traceId?: string;
  /** User ID associated with the violation. */
  userId?: string;
}

/**
 * Result of a safety evaluation.
 */
export interface SafetyEvaluationResult {
  /** Whether the action is allowed. */
  allowed: boolean;
  /** Whether human approval is required. */
  requiresApproval: boolean;
  /** Reason for denial or approval requirement. */
  reason?: string;
  /** Specific policy that was violated or applied. */
  appliedPolicy?: string;
  /** Suggested alternative action if denied. */
  suggestion?: string;
}
