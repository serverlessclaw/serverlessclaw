/**
 * Planner Agent type definitions
 */

export interface PlannerMetadata {
  impact: number;
  urgency: number;
  risk: number;
  priority: number;
  confidence: number;
}

export interface PlannerPayload {
  gapId?: string;
  details?: string; // Legacy
  task?: string; // Standard
  userId: string; // Standard
  contextUserId?: string; // Legacy
  metadata?: PlannerMetadata;
  isScheduledReview?: boolean;
  traceId?: string;
  initiatorId?: string;
  depth?: number;
  sessionId?: string;
}

export interface PlannerEvent {
  detail?: PlannerPayload;
}

export interface PlannerResult {
  gapId?: string;
  plan?: string;
  status?: string;
}
