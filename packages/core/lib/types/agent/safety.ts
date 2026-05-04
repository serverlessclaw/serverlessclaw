import { SafetyTier } from './constants';

/**
 * Safety action types for evaluation by the safety engine.
 */
export enum SafetyActionType {
  DEPLOYMENT = 'deployment',
  CODE_CHANGE = 'code_change',
  FILE_OPERATION = 'file_operation',
  SHELL_COMMAND = 'shell_command',
  MCP_TOOL = 'mcp_tool',
  IAM_CHANGE = 'iam_change',
  INFRA_TOPOLOGY = 'infra_topology',
  ANY = 'any',
}

/**
 * Granular safety policy defining rules for a specific safety tier.
 */
export interface SafetyPolicy {
  tier: SafetyTier;
  requireCodeApproval: boolean;
  requireDeployApproval: boolean;
  requireFileApproval: boolean;
  requireShellApproval: boolean;
  requireMcpApproval: boolean;
  allowedFilePaths?: string[];
  blockedFilePaths?: string[];
  allowedApiEndpoints?: string[];
  blockedApiEndpoints?: string[];
  maxDeploymentsPerDay?: number;
  maxShellCommandsPerHour?: number;
  maxFileWritesPerHour?: number;
  cognitiveThresholds?: {
    minCompletionRate?: number;
    maxErrorRate?: number;
    minCoherence?: number;
    maxMissRate?: number;
    maxAvgLatencyMs?: number;
    maxPivotRate?: number;
    minSampleTasks?: number;
  };
  timeRestrictions?: TimeRestriction[];
}

/**
 * Time-based restriction window.
 */
export interface TimeRestriction {
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
  timezone: string;
  restrictedActions: string[];
  restrictionType: 'block' | 'require_approval';
}

/**
 * Safety violation record for logging and reporting.
 */
export interface SafetyViolation {
  id: string;
  timestamp: Date;
  agentId: string;
  safetyTier: SafetyTier;
  action: string;
  toolName?: string;
  resource?: string;
  reason: string;
  outcome: 'blocked' | 'approval_required' | 'allowed';
  traceId?: string;
  userId?: string;
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
  staffId?: string;
}

/**
 * Result of a safety evaluation.
 */
export interface SafetyEvaluationResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  appliedPolicy?: string;
  suggestion?: string;
  violation?: SafetyViolation;
}
