import { SafetyTier, SafetyPolicy } from '../types/agent';

/**
 * Common file paths that should be blocked for all tiers.
 */
export const COMMON_BLOCKED_PATHS = [
  '.git/**',
  '.env*',
  'package-lock.json',
  'pnpm-lock.yaml',
  'node_modules/**',
];

/**
 * Default safety policies for each tier.
 */
export const DEFAULT_POLICIES: Record<SafetyTier, SafetyPolicy> = {
  [SafetyTier.SANDBOX]: {
    tier: SafetyTier.SANDBOX,
    requireCodeApproval: true,
    requireDeployApproval: true,
    requireFileApproval: true,
    requireShellApproval: true,
    requireMcpApproval: true,
    blockedFilePaths: [...COMMON_BLOCKED_PATHS],
    maxDeploymentsPerDay: 2,
    maxShellCommandsPerHour: 10,
    maxFileWritesPerHour: 20,
    timeRestrictions: [
      {
        daysOfWeek: [0, 6], // Weekends
        startHour: 0,
        endHour: 23,
        timezone: 'UTC',
        restrictedActions: ['deployment', 'shell_command'],
        restrictionType: 'require_approval',
      },
    ],
  },
  [SafetyTier.AUTONOMOUS]: {
    tier: SafetyTier.AUTONOMOUS,
    requireCodeApproval: false,
    requireDeployApproval: false,
    requireFileApproval: false,
    requireShellApproval: false,
    requireMcpApproval: false,
    blockedFilePaths: [...COMMON_BLOCKED_PATHS],
    maxDeploymentsPerDay: 10,
    maxShellCommandsPerHour: 200,
    maxFileWritesPerHour: 500,
  },
};
