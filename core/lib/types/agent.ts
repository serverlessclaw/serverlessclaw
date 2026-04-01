/**
 * @module AgentTypes
 * Core type definitions for the agent swarm, including events, payloads, and lifecycle states.
 */
export interface Attachment {
  /** The type classification of the attachment. */
  type: import('./llm').AttachmentType;
  /** Public URL of the attachment if available. */
  url?: string;
  /** Base64 encoded content for direct ingestion. */
  base64?: string;
  /** Filename for identification. */
  name?: string;
  /** MIME type for correct parser selection. */
  mimeType?: string;
}

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
 * Common properties for all events on the AgentBus.
 */
export interface BaseEvent {
  /** The ID of the user who initiated the session. */
  userId: string;
  /** Global trace ID for correlating all sub-steps. */
  traceId: string;
  /** Unique ID for a specific task/execution unit. */
  taskId: string;
  /** The agent ID that started this task (for routing results). */
  initiatorId: string;
  /** Current recursion depth to prevent infinite delegations. */
  depth: number;
  /** The active session identifier. */
  sessionId?: string;
}

/**
 * Shared payload for EventBridge-triggered agent handlers.
 */
export interface AgentPayload extends BaseEvent {
  /** The actual instruction or query for the agent. */
  task?: string;
  /** The text response from the agent. */
  response?: string;
  /** Additional structured data associated with the event. */
  metadata?: Record<string, unknown>;
  /** Multi-modal artifacts associated with this payload. */
  attachments?: Attachment[];
  /** Whether this is a continuation of a previously paused task. */
  isContinuation?: boolean;
}

/**
 * Shared EventBridge event structure for agent handlers.
 */
export interface AgentEvent {
  /** The structured detail of the event. */
  detail?: AgentPayload;
  /** The source of the event (e.g., 'core.superclaw'). */
  source?: string;
}

/**
 * Task delegation event emitted when an agent assigns work to another.
 */
export interface TaskEvent extends BaseEvent {
  /** The specific instruction or task description. */
  task: string;
  /** Whether this is a continuation of a previously paused task. */
  isContinuation?: boolean;
  /** Arbitrary metadata associated with the task. */
  metadata?: Record<string, unknown>;
  /** Files or images required for the task. */
  attachments?: Attachment[];
}

/**
 * System build event emitted by CodeBuild or the Monitor.
 */
export interface BuildEvent extends BaseEvent {
  /** AWS CodeBuild ID. */
  buildId: string;
  /** The SST/CodeBuild project name. */
  projectName: string;
  /** The task description that triggered this build. */
  task?: string;
  /** Standard error logs if the build failed. */
  errorLogs?: string;
  /** IDs of strategic gaps addressed by this build. */
  gapIds?: string[];
}

/**
 * Task completion event emitted when an agent successfully finishes work.
 */
export interface CompletionEvent extends BaseEvent {
  /** The ID of the agent completing the task. */
  agentId: string;
  /** The original task description. */
  task: string;
  /** The final result or response string. */
  response: string;
  /** Results returned as attachments (e.g., charts, files). */
  attachments?: Attachment[];
  /** Whether the end user has already been notified of this result. */
  userNotified?: boolean;
}

/**
 * Outbound message event for external channels (Slack, Telegram, Dashboard).
 */
export interface OutboundMessageEvent extends BaseEvent {
  /** The message text to be sent. */
  message: string;
  /** Optional override for the sender's display name. */
  agentName?: string;
  /** Relevant memory IDs for citation or grounding. */
  memoryContexts?: string[];
  /** Any files or images to include in the message. */
  attachments?: Attachment[];
  /** Functional buttons or options for user interaction. */
  options?: {
    /** The text displayed on the button. */
    label: string;
    /** The value payload sent back when clicked. */
    value: string;
    /** The visual style or type of the button. */
    type?: import('./llm').ButtonType;
  }[];
  /** Optional collaboration ID for multi-human notification fan-out. */
  collaborationId?: string;
}

/**
 * Task failure event emitted when an agent encounters an unrecoverable error.
 */
export interface FailureEvent extends BaseEvent {
  /** The ID of the agent reporting the failure. */
  agentId: string;
  /** The original task description. */
  task: string;
  /** The error message or stack trace. */
  error: string;
  /** Whether the end user has already been notified of this failure. */
  userNotified?: boolean;
}

/**
 * System health report event for proactive monitoring.
 */
export interface HealthReportEvent extends BaseEvent {
  /** The system component being reported (e.g., 'DynamoDB', 'EventBridge'). */
  component: string;
  /** Detailed description of the health issue. */
  issue: string;
  /** The urgency level of the report. */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Additional diagnostic context. */
  context?: Record<string, unknown>;
}

/**
 * Payload for a proactive heartbeat signal from the dynamic scheduler.
 * Used for periodic strategic reviews and health checks.
 */
export interface ProactiveHeartbeatPayload extends BaseEvent {
  /** The ID of the agent that should respond to this heartbeat. */
  agentId: string;
  /** The specific task or goal to be performed. */
  task: string;
  /** Unique ID for the goal or schedule. */
  goalId: string;
  /** Optional additional metadata for execution. */
  metadata?: Record<string, unknown>;
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
 * - sandbox: All actions require HITL approval
 * - autonomous: Full self-evolution (current AUTO mode)
 */
export enum SafetyTier {
  SANDBOX = 'sandbox',
  AUTONOMOUS = 'autonomous',
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
}

/**
 * Origin of a request or task.
 */
export enum TraceSource {
  DASHBOARD = 'dashboard',
  TELEGRAM = 'telegram',
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
  /** Real-time message chunk for streaming responses. */
  CHUNK = 'chunk',
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
  reasoning?: string;
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
