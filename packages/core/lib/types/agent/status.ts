/**
 * Lifecycle stages for identified capability gaps.
 */
export enum GapStatus {
  OPEN = 'OPEN',
  PLANNED = 'PLANNED',
  PROGRESS = 'PROGRESS',
  DEPLOYED = 'DEPLOYED',
  DONE = 'DONE',
  FAILED = 'FAILED',
  ARCHIVED = 'ARCHIVED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
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
 * Operational modes for system evolution.
 */
export enum EvolutionMode {
  AUTO = 'auto',
  HITL = 'hitl',
}

/**
 * Evolution tracks for parallel multi-track evolution.
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
  maxConcurrentGaps: number;
  priority: number;
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
 * Result of a gap status transition attempt.
 */
export interface GapTransitionResult {
  success: boolean;
  currentStatus?: GapStatus;
  error?: string;
}
