/**
 * Escalation Policy Types for Human-Agent Interaction
 * Supports multi-channel, time-based escalation ladders
 */

export enum EscalationChannel {
  TELEGRAM = 'telegram',
  DASHBOARD = 'dashboard',
  EMAIL = 'email',
  SMS = 'sms',
  SLACK = 'slack',
}

export enum EscalationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface EscalationLevel {
  /** Level number (1-based) */
  level: number;
  /** Timeout in milliseconds before escalating to next level */
  timeoutMs: number;
  /** Channels to notify at this level */
  channels: EscalationChannel[];
  /** Message template for this escalation level */
  messageTemplate?: string;
  /** Whether to continue to next level if this one fails */
  continueOnFailure: boolean;
}

export interface EscalationPolicy {
  /** Unique policy identifier */
  id: string;
  /** Human-readable policy name */
  name: string;
  /** Description of when this policy applies */
  description?: string;
  /** Priority level for this policy */
  priority: EscalationPriority;
  /** Ordered list of escalation levels */
  levels: EscalationLevel[];
  /** Default action when all escalation levels are exhausted */
  finalAction: 'fail' | 'continue_with_defaults' | 'escalate_to_admin';
  /** Optional admin user IDs for final escalation */
  adminUserIds?: string[];
  /** Whether this policy is enabled */
  enabled: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

export interface EscalationState {
  /** Trace ID for the original request */
  traceId: string;
  /** Agent ID that requested clarification */
  agentId: string;
  /** User ID who needs to respond */
  userId: string;
  /** Session ID for context */
  sessionId?: string;
  /** Current escalation level */
  currentLevel: number;
  /** Policy ID being applied */
  policyId: string;
  /** Timestamp when escalation started */
  startedAt: number;
  /** Timestamp when current level timeout expires */
  currentLevelExpiresAt: number;
  /** Channels notified at current level */
  notifiedChannels: EscalationChannel[];
  /** Whether escalation is complete */
  completed: boolean;
  /** Final outcome if completed */
  outcome?: 'answered' | 'failed' | 'continued_with_defaults' | 'escalated_to_admin';
  /** Workspace identifier for isolation */
  workspaceId?: string;
  /** Team identifier for isolation */
  teamId?: string;
  /** Staff identifier for isolation */
  staffId?: string;
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  id: 'default',
  name: 'Default Escalation Policy',
  description: 'Standard escalation for clarification requests',
  priority: EscalationPriority.MEDIUM,
  levels: [
    {
      level: 1,
      timeoutMs: 300000, // 5 minutes
      channels: [EscalationChannel.TELEGRAM],
      messageTemplate: 'URGENT: Agent needs your input. {{question}}',
      continueOnFailure: true,
    },
    {
      level: 2,
      timeoutMs: 600000, // 10 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD],
      messageTemplate: 'ESCALATION: Still waiting for your response. {{question}}',
      continueOnFailure: true,
    },
    {
      level: 3,
      timeoutMs: 900000, // 15 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD, EscalationChannel.EMAIL],
      messageTemplate: 'FINAL NOTICE: Agent will timeout without your input. {{question}}',
      continueOnFailure: false,
    },
  ],
  finalAction: 'fail',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
