/**
 * Default Escalation Policy Configurations
 * Pre-configured policies for different scenarios
 */

import { EscalationPolicy, EscalationChannel, EscalationPriority } from '../types/escalation';

/**
 * Default clarification escalation policy
 * Used for standard clarification requests
 */
export const DEFAULT_CLARIFICATION_POLICY: EscalationPolicy = {
  id: 'default-clarification',
  name: 'Default Clarification Escalation',
  description: 'Standard 3-level escalation for clarification requests',
  priority: EscalationPriority.MEDIUM,
  levels: [
    {
      level: 1,
      timeoutMs: 300000, // 5 minutes
      channels: [EscalationChannel.TELEGRAM],
      messageTemplate:
        '⚠️ **Input Needed**\n\nAgent needs your clarification:\n\n**Question:** {{question}}\n\nPlease respond within 5 minutes.',
      continueOnFailure: true,
    },
    {
      level: 2,
      timeoutMs: 600000, // 10 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD],
      messageTemplate:
        '🔔 **Escalation Level 2**\n\nStill waiting for your response:\n\n**Question:** {{question}}\n\nPlease respond within 10 minutes.',
      continueOnFailure: true,
    },
    {
      level: 3,
      timeoutMs: 900000, // 15 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD, EscalationChannel.EMAIL],
      messageTemplate:
        '🚨 **Final Notice**\n\nThis is your final reminder:\n\n**Question:** {{question}}\n\nTask will timeout without your input.',
      continueOnFailure: false,
    },
  ],
  finalAction: 'fail',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Critical task escalation policy
 * Used for high-priority tasks requiring immediate attention
 */
export const CRITICAL_TASK_POLICY: EscalationPolicy = {
  id: 'critical-task',
  name: 'Critical Task Escalation',
  description: 'Aggressive 2-level escalation for critical tasks',
  priority: EscalationPriority.CRITICAL,
  levels: [
    {
      level: 1,
      timeoutMs: 120000, // 2 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD],
      messageTemplate:
        '🚨 **CRITICAL: Immediate Input Required**\n\n{{question}}\n\nRespond within 2 minutes.',
      continueOnFailure: true,
    },
    {
      level: 2,
      timeoutMs: 300000, // 5 minutes
      channels: [
        EscalationChannel.TELEGRAM,
        EscalationChannel.DASHBOARD,
        EscalationChannel.EMAIL,
        EscalationChannel.SMS,
      ],
      messageTemplate:
        '🔴 **CRITICAL ESCALATION**\n\nFinal warning for critical task:\n\n{{question}}\n\nTask will fail without immediate response.',
      continueOnFailure: false,
    },
  ],
  finalAction: 'fail',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Background task escalation policy
 * Used for non-urgent background tasks
 */
export const BACKGROUND_TASK_POLICY: EscalationPolicy = {
  id: 'background-task',
  name: 'Background Task Escalation',
  description: 'Relaxed escalation for background tasks',
  priority: EscalationPriority.LOW,
  levels: [
    {
      level: 1,
      timeoutMs: 1800000, // 30 minutes
      channels: [EscalationChannel.DASHBOARD],
      messageTemplate: 'ℹ️ **Background Task Update**\n\nWhen you have a moment:\n\n{{question}}',
      continueOnFailure: true,
    },
    {
      level: 2,
      timeoutMs: 3600000, // 1 hour
      channels: [EscalationChannel.DASHBOARD, EscalationChannel.TELEGRAM],
      messageTemplate: '**REMINDER**\n\nBackground task still waiting:\n\n{{question}}',
      continueOnFailure: false,
    },
  ],
  finalAction: 'continue_with_defaults',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Admin escalation policy
 * Escalates to admin users when user doesn't respond
 */
export const ADMIN_ESCALATION_POLICY: EscalationPolicy = {
  id: 'admin-escalation',
  name: 'Admin Escalation Policy',
  description: 'Escalates to admin users after user timeout',
  priority: EscalationPriority.HIGH,
  levels: [
    {
      level: 1,
      timeoutMs: 300000, // 5 minutes
      channels: [EscalationChannel.TELEGRAM],
      messageTemplate: '⚠️ **Input Needed**\n\n{{question}}\n\nPlease respond within 5 minutes.',
      continueOnFailure: true,
    },
    {
      level: 2,
      timeoutMs: 600000, // 10 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD],
      messageTemplate: '🔔 **Escalation**\n\nStill waiting:\n\n{{question}}',
      continueOnFailure: true,
    },
    {
      level: 3,
      timeoutMs: 900000, // 15 minutes
      channels: [EscalationChannel.TELEGRAM, EscalationChannel.DASHBOARD, EscalationChannel.EMAIL],
      messageTemplate: '**FINAL NOTICE**\n\nLast chance to respond:\n\n{{question}}',
      continueOnFailure: false,
    },
  ],
  finalAction: 'escalate_to_admin',
  adminUserIds: [], // Configure admin user IDs in deployment
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * All default escalation policies
 */
export const DEFAULT_ESCALATION_POLICIES: EscalationPolicy[] = [
  DEFAULT_CLARIFICATION_POLICY,
  CRITICAL_TASK_POLICY,
  BACKGROUND_TASK_POLICY,
  ADMIN_ESCALATION_POLICY,
];

/**
 * Maps priority to default policy ID
 */
export const PRIORITY_TO_POLICY_MAP: Record<EscalationPriority, string> = {
  [EscalationPriority.LOW]: 'background-task',
  [EscalationPriority.MEDIUM]: 'default-clarification',
  [EscalationPriority.HIGH]: 'admin-escalation',
  [EscalationPriority.CRITICAL]: 'critical-task',
};
