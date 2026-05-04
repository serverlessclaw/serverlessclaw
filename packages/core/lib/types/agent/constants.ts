/**
 * Predefined agent role types.
 */
export const AGENT_TYPES = {
  SUPERCLAW: 'superclaw',
  CODER: 'coder',
  BUILD_MONITOR: 'monitor',
  EVENT_HANDLER: 'events',
  RECOVERY: 'recovery',
  STRATEGIC_PLANNER: 'strategic-planner',
  COGNITION_REFLECTOR: 'cognition-reflector',
  QA: 'qa',
  CRITIC: 'critic',
  FACILITATOR: 'facilitator',
  MERGER: 'merger',
  RESEARCHER: 'researcher',
  JUDGE: 'judge',
} as const;

export type AgentRole = (typeof AGENT_TYPES)[keyof typeof AGENT_TYPES] | (string & {});

/**
 * Categorization of agents to guide orchestration.
 */
export enum AgentCategory {
  SOCIAL = 'social',
  SYSTEM = 'system',
}

/**
 * Safety tiers for agent trust levels.
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
 * Priority levels for tasks, events, and metadata.
 */
export enum PriorityLevel {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
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
  PLAYGROUND = 'playground',
  PLAYWRIGHT = 'playwright',
}
