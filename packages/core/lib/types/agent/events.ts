import type { AgentPayloadInferred } from '../../schema/events';

/**
 * Standard system event types for communication between agents.
 */
export enum EventType {
  /** Task assigned to the Coder agent. */
  CODER_TASK = 'coder_task',
  /** Coder agent successfully completed a task. */
  CODER_TASK_COMPLETED = 'coder_task_completed',
  /** Infrastructure build failed. */
  SYSTEM_BUILD_FAILED = 'system_build_failed',
  /** Infrastructure build succeeded. */
  SYSTEM_BUILD_SUCCESS = 'system_build_success',
  /** Request to monitor a build process. */
  MONITOR_BUILD = 'monitor_build',
  /** Log entry for system recovery operations. */
  RECOVERY_LOG = 'recovery_log',
  /** Proposed evolution plan for an agent. */
  EVOLUTION_PLAN = 'evolution_plan',
  /** Task assigned to the Cognition Reflector agent. */
  REFLECT_TASK = 'reflect_task',
  /** Message to be sent to an external platform (e.g. Telegram). */
  OUTBOUND_MESSAGE = 'outbound_message',
  /** Continuation of a previous task. */
  CONTINUATION_TASK = 'continuation_task',
  /** General task completion signal. */
  TASK_COMPLETED = 'task_completed',
  /** General task failure signal. */
  TASK_FAILED = 'task_failed',
  /** Periodic report of system health metrics. */
  SYSTEM_HEALTH_REPORT = 'system_health_report',
  /** Request for clarification from a human or another agent. */
  CLARIFICATION_REQUEST = 'clarification_request',
  /** Clarification request timed out without response. */
  CLARIFICATION_TIMEOUT = 'clarification_timeout',
  /** Task scheduled for future execution. */
  SCHEDULE_TASK = 'schedule_task',
  /** Proactive heartbeat check from an agent. */
  HEARTBEAT_PROACTIVE = 'heartbeat_proactive',
  /** Task was explicitly cancelled. */
  TASK_CANCELLED = 'task_cancelled',
  /** Dispatch signal for parallel task execution. */
  PARALLEL_TASK_DISPATCH = 'parallel_task_dispatch',
  /** Completion signal for a parallel task. */
  PARALLEL_TASK_COMPLETED = 'parallel_task_completed',
  /** Timeout reached while waiting for parallel tasks. */
  PARALLEL_BARRIER_TIMEOUT = 'parallel_barrier_timeout',
  /** Completion signal for a task in a Directed Acyclic Graph. */
  DAG_TASK_COMPLETED = 'dag_task_completed',
  /** Failure signal for a task in a Directed Acyclic Graph. */
  DAG_TASK_FAILED = 'dag_task_failed',
  /** A chunk of streaming content. */
  CHUNK = 'chunk',

  // --- AG-UI Protocol Standard Events ---
  /** Agent run started. */
  RUN_STARTED = 'RUN_STARTED',
  /** Agent run finished. */
  RUN_FINISHED = 'RUN_FINISHED',
  /** Agent run encountered an error. */
  RUN_ERROR = 'RUN_ERROR',
  /** Start of a text message. */
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  /** Content chunk of a text message. */
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  /** End of a text message. */
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',
  /** Start of a tool call. */
  TOOL_CALL_START = 'TOOL_CALL_START',
  /** Arguments for a tool call. */
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  /** End of a tool call. */
  TOOL_CALL_END = 'TOOL_CALL_END',
  /** Full snapshot of agent state. */
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  /** Incremental change to agent state. */
  STATE_DELTA = 'STATE_DELTA',
  /** Full snapshot of message history. */
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',

  /** Task assigned to the Critic agent. */
  CRITIC_TASK = 'critic_task',
  /** Update to an agent's reputation score. */
  REPUTATION_UPDATE = 'reputation_update',
  /** Request for consensus among a swarm of agents. */
  CONSENSUS_REQUEST = 'consensus_request',
  /** Individual vote in a consensus process. */
  CONSENSUS_VOTE = 'consensus_vote',
  /** Consensus reached successfully. */
  CONSENSUS_REACHED = 'consensus_reached',
  /** Escalation level timed out. */
  ESCALATION_LEVEL_TIMEOUT = 'escalation_level_timeout',
  /** Escalation process completed. */
  ESCALATION_COMPLETED = 'escalation_completed',
  /** Handoff of task to another agent. */
  HANDOFF = 'handoff',
  /** Alert regarding system or agent health. */
  HEALTH_ALERT = 'health_alert',
  /** Trigger for a cognitive health check. */
  COGNITIVE_HEALTH_CHECK = 'cognitive_health_check',
  /** Task assigned to the Researcher agent. */
  RESEARCH_TASK = 'research_task',
  /** Task assigned to the Merger agent. */
  MERGER_TASK = 'merger_task',
  /** Task assigned to the Facilitator agent. */
  FACILITATOR_TASK = 'facilitator_task',
  /** Task assigned to the QA agent. */
  QA_TASK = 'qa_task',
  /** Task assigned to the Cognition Reflector agent. */
  COGNITION_REFLECTOR_TASK = 'cognition_reflector_task',
  /** Task assigned to the Strategic Planner agent. */
  STRATEGIC_PLANNER_TASK = 'strategic_planner_task',
  /** Control signal for orchestration logic. */
  ORCHESTRATION_SIGNAL = 'orchestration_signal',
  /** Tie-breaking signal for strategic decisions. */
  STRATEGIC_TIE_BREAK = 'strategic_tie_break',
  /** Agent reporting back after task completion. */
  REPORT_BACK = 'report_back',
  /** Delegation of a sub-task. */
  DELEGATION_TASK = 'delegation_task',
  /** Trigger for a system-wide audit. */
  SYSTEM_AUDIT_TRIGGER = 'system_audit_trigger',
  /** Failure detected on the dashboard. */
  DASHBOARD_FAILURE_DETECTED = 'dashboard_failure_detected',
  /** Routing signal for Dead Letter Queue entries. */
  DLQ_ROUTE = 'dlq_route',
  /** Pulse ping for connectivity checks. */
  PULSE_PING = 'pulse_ping',
  /** Pulse pong response for connectivity checks. */
  PULSE_PONG = 'pulse_pong',
}

/**
 * Event source identifiers for tracking event origins.
 */
export enum EventSource {
  /** The system dashboard (Next.js). */
  DASHBOARD = 'dashboard',
  /** Telegram bot integration. */
  TELEGRAM = 'telegram',
  /** Public API gateway. */
  API = 'api',
  /** Internal system core. */
  SYSTEM = 'system',
  /** AWS CodeBuild project. */
  CODEBUILD = 'codebuild',
  /** AWS EventBridge Scheduler. */
  SCHEDULER = 'scheduler',
  /** Main agent orchestrator. */
  ORCHESTRATOR = 'orchestrator',
  /** Cold start warmup manager. */
  WARMUP_MANAGER = 'warmup-manager',
  /** A generic agent. */
  AGENT = 'agent',
  /** Parallel execution engine. */
  PARALLEL = 'parallel',
  /** The SuperClaw supervisor agent. */
  SUPERCLAW = 'superclaw',
  /** The Critic agent. */
  AGENT_CRITIC = 'agent.critic',
  /** The Researcher agent. */
  AGENT_RESEARCHER = 'agent.researcher',
  /** The Facilitator agent. */
  AGENT_FACILITATOR = 'agent.facilitator',
  /** Batch evolution process. */
  BATCH_EVOLUTION = 'batch_evolution',
  /** Dedicated heartbeat scheduler. */
  HEARTBEAT_SCHEDULER = 'heartbeat.scheduler',
  /** System recovery logic. */
  CORE_RECOVERY = 'core.recovery',
  /** External webhook integration. */
  WEBHOOK = 'webhook',
  /** Unknown or uninitialized source. */
  UNKNOWN = 'unknown',
}

/**
 * Event routing configuration for dynamic dispatch.
 */
export interface EventRoutingEntry {
  module: string;
  function: string;
  passContext?: boolean;
}

/**
 * Map of EventType identifiers to routing entries.
 */
export type EventRoutingTable = Record<string, EventRoutingEntry>;

/**
 * Shared EventBridge event structure for agent handlers.
 */
export interface AgentPayload extends AgentPayloadInferred {
  userId: string;
  traceId: string;
  sessionId: string;
  task: string;
  workspaceId?: string;
}

export interface AgentEvent {
  detail: AgentPayload;
  source: string;
}
