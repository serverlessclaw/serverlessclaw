/**
 * Planner Agent type definitions
 */

/**
 * Metadata signals extracted for identified capability gaps.
 */
export interface PlannerMetadata {
  /** Estimated impact on system autonomy (1-10). */
  impact: number;
  /** Estimated urgency of the fix (1-10). */
  urgency: number;
  /** Estimated technical risk of the plan (1-10). */
  risk: number;
  /** Calculated priority score. */
  priority: number;
  /** Agent's confidence in the analysis (1-10). */
  confidence: number;
}

/**
 * Payload for the Strategic Planner agent.
 */
export interface PlannerPayload {
  /** Optional ID of a specific gap to analyze. */
  gapId?: string;
  /** Legacy field for task details. */
  details?: string;
  /** Standard task description. */
  task?: string;
  /** The user ID context for the request. */
  userId: string;
  /** Legacy context user ID. */
  contextUserId?: string;
  /** Strategic metadata for gap prioritization. */
  metadata?: PlannerMetadata;
  /** Whether this is a scheduled periodic review. */
  isScheduledReview?: boolean;
  /** Trace ID for orchestration tracking. */
  traceId?: string;
  /** ID of the initiating agent. */
  initiatorId?: string;
  /** Current recursion depth. */
  depth?: number;
  /** Active session identifier. */
  sessionId?: string;
  /** ID of an existing plan to refine. */
  planId?: string;
}

/**
 * Event structure for the Strategic Planner.
 */
export interface PlannerEvent {
  /** The structured planner payload. */
  detail?: PlannerPayload;
}

/**
 * Result structure returned by the Strategic Planner.
 */
export interface PlannerResult {
  /** The ID of the analyzed gap. */
  gapId?: string;
  /** The generated strategic plan text. */
  plan?: string;
  /** The ID of the generated plan. */
  planId?: string;
  /** Operation status code. */
  status?: string;
  /** The agent ID that currently holds the gap lock (returned when gap is locked). */
  lockedBy?: string;
}
