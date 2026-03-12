/**
 * Configuration for an agent instance.
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
  /** Icon name for UI representation. */
  icon?: string;
  /** Specific LLM model ID override. */
  model?: string;
  /** Specific LLM provider name override. */
  provider?: string;
  /** List of tool names assigned to this agent. */
  tools?: string[];
  /** Whether the agent is currently active. */
  enabled: boolean;
  /** Whether this is a hardcoded system agent (cannot be deleted). */
  isBackbone?: boolean;
  /** Resource connections for the agent (e.g., 'bus', 'memory'). */
  connectionProfile?: string[];
  /** Maximum tool execution loops allowed in a single turn. */
  maxIterations?: number;
  /** Whether the agent can call multiple tools in parallel. */
  parallelToolCalls?: boolean;
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
 * Generic interface for communication channels.
 */
export interface IChannel {
  /** Sends a message to a specific user via the channel. */
  send(userId: string, text: string): Promise<void>;
}
