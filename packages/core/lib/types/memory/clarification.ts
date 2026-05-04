/**
 * Lifecycle status of a clarification request.
 */
export enum ClarificationStatus {
  /** Clarification request is pending a response. */
  PENDING = 'pending',
  /** Clarification has been answered by the initiator. */
  ANSWERED = 'answered',
  /** Clarification request timed out without a response. */
  TIMED_OUT = 'timed_out',
  /** Clarification has been escalated to a higher authority. */
  ESCALATED = 'escalated',
  /** Escalation process has been completed. */
  ESCALATION_COMPLETED = 'escalation_completed',
}

export interface ClarificationState {
  userId: string;
  timestamp: number | string;
  type: 'CLARIFICATION_PENDING';
  agentId: string;
  initiatorId: string;
  question: string;
  originalTask: string;
  traceId: string;
  sessionId?: string;
  depth: number;
  status: ClarificationStatus;
  createdAt: number;
  expiresAt: number;
  retryCount: number;
  workspaceId?: string;
}
