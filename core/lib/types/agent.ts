export interface Attachment {
  type: 'image' | 'file';
  url?: string;
  base64?: string;
  name?: string;
  mimeType?: string;
}

/**
 * Configuration for an agent instance.
 */
export interface BaseEvent {
  userId: string;
  traceId?: string;
  initiatorId?: string; // The agent ID that started this task
  depth?: number; // To prevent infinite loops
  sessionId?: string;
}

/**
 * Shared payload for EventBridge-triggered agent handlers.
 */
export interface AgentPayload extends BaseEvent {
  task?: string;
  response?: string;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
  isContinuation?: boolean;
}

/**
 * Shared EventBridge event structure for agent handlers.
 */
export interface AgentEvent {
  detail?: AgentPayload;
  source?: string;
}

/**
 * Task delegation event.
 */
export interface TaskEvent extends BaseEvent {
  task: string;
  isContinuation?: boolean;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
}

/**
 * System build event (success or failure).
 */
export interface BuildEvent extends BaseEvent {
  buildId: string;
  projectName: string;
  task?: string;
  errorLogs?: string;
  gapIds?: string[];
}

/**
 * Task completion event.
 */
export interface CompletionEvent extends BaseEvent {
  agentId: string;
  task: string;
  response: string;
  attachments?: Attachment[];
}

/**
 * Outbound message event for external channels.
 */
export interface OutboundMessageEvent extends BaseEvent {
  message: string;
  agentName?: string;
  memoryContexts?: string[];
  attachments?: Attachment[];
}

/**
 * Task failure event.
 */
export interface FailureEvent extends BaseEvent {
  agentId: string;
  task: string;
  error: string;
}

/**
 * System health report event.
 */
export interface HealthReportEvent extends BaseEvent {
  component: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
}

/**
 * Payload for a proactive heartbeat signal from the dynamic scheduler.
 */
export interface ProactiveHeartbeatPayload extends BaseEvent {
  /** The ID of the agent that should respond to this heartbeat. */
  agentId: string;
  /** The task or goal to be performed. */
  task: string;
  /** Unique ID for the goal or schedule. */
  goalId: string;
  /** Optional additional metadata. */
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
  /** Explicit UI metadata overrides for topology visualization. */
  topologyOverride?: {
    label?: string;
    icon?: string;
    tier?: 'APP' | 'COMM' | 'AGENT' | 'INFRA';
  };
}

/**
 * Predefined agent role types.
 */
export enum AgentType {
  /** The primary manager agent. */
  MAIN = 'main',
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
  /** Request to schedule a future task or heartbeat. */
  SCHEDULE_TASK = 'schedule_task',
  /** Proactive heartbeat signal indicating a scheduled goal or task activation. */
  HEARTBEAT_PROACTIVE = 'heartbeat_proactive',
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
}

/**
 * Structured output signal for agent orchestration.
 */
export interface AgentSignal {
  status: AgentStatus;
  coveredGapIds?: string[];
  buildId?: string;
  reasoning?: string;
}

/**
 * Generic interface for communication channels.
 */
export interface IChannel {
  /** Sends a message to a specific user via the channel. */
  send(userId: string, text: string): Promise<void>;
}
