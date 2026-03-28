import { ToolCall, Message } from '../types/index';

export const AGENT_DEFAULTS = {
  MAX_ITERATIONS: 25,
  REFLECTION_FREQUENCY: 25,
  TIMEOUT_BUFFER_MS: 30000,
} as const;

export const AGENT_LOG_MESSAGES = {
  TIMEOUT_APPROACHING: 'Lambda timeout approaching, pausing task...',
  RECOVERY_LOG_PREFIX: '\n\nSYSTEM_RECOVERY_LOG: Recent emergency rollback occurred. Details: ',
  TASK_PAUSED_TIMEOUT:
    'TASK_PAUSED: I need more time to complete this. I have checkpointed my progress and am resuming in a fresh execution...',
  TASK_PAUSED_ITERATION_LIMIT:
    'TASK_PAUSED: This task is complex and requires multiple steps. I have reached my single-turn safety limit and am resuming in a fresh execution...',
} as const;

export interface ExecutorUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  total_tokens: number;
  toolCallCount: number;
  durationMs: number;
}

export interface LoopResult {
  responseText: string;
  paused?: boolean;
  asyncWait?: boolean;
  pauseMessage?: string;
  attachments?: NonNullable<Message['attachments']>;
  thought?: string;
  tool_calls?: ToolCall[];
  options?: Array<{ label: string; value: string; type?: string }>;
  usage?: ExecutorUsage;
}
