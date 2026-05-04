/**
 * Agent-related constants to eliminate magic strings and improve AI signal clarity.
 */
export const AGENT_SYSTEM_IDS = {
  ORCHESTRATOR: 'orchestrator',
  SYSTEM: 'SYSTEM',
  DASHBOARD_USER: 'dashboard-user',
  UNKNOWN: 'unknown',
  SUPERCLAW: 'SuperClaw',
  DEFAULT_AGENT: 'Agent',
};

export const COMMUNICATION_MODES = {
  TEXT: 'text',
  JSON: 'json',
} as const;

export const TRACE_MESSAGES = {
  OBSERVE_MODE: 'HUMAN_TAKING_CONTROL: Entering observe mode.',
  BUDGET_EXCEEDED: (traceId: string) =>
    `[BUDGET_EXCEEDED] Global execution budget for trace ${traceId} has been reached. Halting further processing.`,
};
