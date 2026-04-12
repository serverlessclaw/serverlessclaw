import { SafetyTier, SafetyPolicy } from '../types/agent';
import { PROTECTED_FILES } from '../constants/tools';

/**
 * Default safety policies for each tier.
 */
export const DEFAULT_POLICIES: Record<SafetyTier, SafetyPolicy> = {
  [SafetyTier.LOCAL]: {
    tier: SafetyTier.LOCAL,
    requireCodeApproval: false,
    requireDeployApproval: false,
    requireFileApproval: false,
    requireShellApproval: false,
    requireMcpApproval: false,
    blockedFilePaths: [...PROTECTED_FILES],
    maxDeploymentsPerDay: 50,
    maxShellCommandsPerHour: 200,
    maxFileWritesPerHour: 500,
    cognitiveThresholds: {
      minCompletionRate: 0.7,
      maxErrorRate: 0.3,
      minCoherence: 5.0,
      maxMissRate: 0.5,
      maxAvgLatencyMs: 15000,
      maxPivotRate: 0.2,
      minSampleTasks: 5,
    },
  },
  [SafetyTier.PROD]: {
    tier: SafetyTier.PROD,
    requireCodeApproval: false,
    requireDeployApproval: true,
    requireFileApproval: false,
    requireShellApproval: false,
    requireMcpApproval: false,
    blockedFilePaths: [...PROTECTED_FILES],
    maxDeploymentsPerDay: 10,
    maxShellCommandsPerHour: 50,
    maxFileWritesPerHour: 100,
    cognitiveThresholds: {
      minCompletionRate: 0.85,
      maxErrorRate: 0.15,
      minCoherence: 7.0,
      maxMissRate: 0.3,
      maxAvgLatencyMs: 10000,
      maxPivotRate: 0.1,
      minSampleTasks: 10,
    },
    timeRestrictions: [
      {
        daysOfWeek: [1, 2, 3, 4, 5], // Weekdays
        startHour: 9,
        endHour: 17,
        timezone: 'America/New_York',
        restrictedActions: ['deployment'],
        restrictionType: 'require_approval',
      },
    ],
  },
};
