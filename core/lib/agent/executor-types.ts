import { ToolCall, Message, ReasoningProfile } from '../types/index';
import { ClawTracer } from '../tracer';
import { Context as LambdaContext } from 'aws-lambda';

export const AGENT_DEFAULTS = {
  MAX_ITERATIONS: 25,
  REFLECTION_FREQUENCY: 25,
  TIMEOUT_BUFFER_MS: 5000,
  WORKER_FEEDBACK_ENABLED: true,
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
  ui_blocks?: Message['ui_blocks'];
  options?: Array<{ label: string; value: string; type?: string }>;
  usage?: ExecutorUsage;
}

/**
 * Core identity fields that MUST be provided by the caller.
 * These are resolved upstream in Agent.process() before reaching the executor.
 */
export interface ExecutorCoreOptions {
  /** The LLM model ID (e.g., 'gpt-5.4'). Must be resolved before calling executor. */
  activeModel: string;
  /** The LLM provider name (e.g., 'openai'). Must be resolved before calling executor. */
  activeProvider: string;
  /** The reasoning profile controlling depth/cost tradeoff. */
  activeProfile: ReasoningProfile;
  /** Maximum tool-call iterations allowed. */
  maxIterations: number;
  /** Tracer for observability. */
  tracer: ClawTracer;
  /** Global trace ID for DAG correlation. */
  traceId: string;
  /** Unique task ID for cancellation checks. */
  taskId: string;
  /** Current node ID in the trace DAG. */
  nodeId: string;
  /** The agent that initiated this task (for result routing). */
  currentInitiator: string;
  /** Current recursion depth for loop protection. */
  depth: number;
  /** The user who owns this conversation. */
  userId: string;
  /** The raw user text that triggered this execution. */
  userText: string;
  /** The main conversation storage ID. */
  mainConversationId: string;
}

/**
 * Optional feature fields that enhance execution behavior.
 * These have sensible defaults or are only needed for specific scenarios.
 */
export interface ExecutorFeatureOptions {
  /** Lambda execution context for timeout checks. */
  context?: LambdaContext;
  /** Parent node ID in the trace DAG. */
  parentId?: string;
  /** Session ID for pending message injection and IoT streaming. */
  sessionId?: string;
  /** Response format for structured output. */
  responseFormat?: import('../types/index').ResponseFormat;
  /** Task timeout in milliseconds. */
  taskTimeoutMs?: number;
  /** Behavior when timeout is reached. */
  timeoutBehavior?: 'pause' | 'fail' | 'continue';
  /** Session state manager for concurrent message handling. */
  sessionStateManager?: import('../session/session-state').SessionStateManager;
  /** List of approved tool call IDs (for HITL). */
  approvedToolCalls?: string[];
  /** Whether this is a continuation of a previously paused task. */
  isContinuation?: boolean;
  /** Communication mode: 'text' for human, 'json' for agent-to-agent. */
  communicationMode?: 'text' | 'json';
  /** Emitter for real-time streaming to dashboard. */
  emitter?: import('./emitter').AgentEmitter;
  /** Sampling temperature (0.0 to 1.0). */
  temperature?: number;
  /** Maximum tokens for completion. */
  maxTokens?: number;
  /** Nucleus sampling probability. */
  topP?: number;
  /** Stop sequences for generation. */
  stopSequences?: string[];
  /** Maximum token budget for this task. */
  tokenBudget?: number;
  /** Maximum cost limit (USD) for this task. */
  costLimit?: number;
}

/** Combined executor options: core (required) + features (optional). */
export type ExecutorOptions = ExecutorCoreOptions & ExecutorFeatureOptions;

/**
 * Validates that all required executor options are present.
 */
export function validateExecutorOptions(options: ExecutorOptions): void {
  const required: (keyof ExecutorCoreOptions)[] = [
    'activeModel',
    'activeProvider',
    'activeProfile',
    'maxIterations',
    'tracer',
    'traceId',
    'taskId',
    'nodeId',
    'currentInitiator',
    'depth',
    'userId',
    'userText',
    'mainConversationId',
  ];

  const missing = required.filter(
    (key) => options[key] === undefined || options[key] === null || options[key] === ''
  );

  if (missing.length > 0) {
    throw new Error(`ExecutorOptions missing required fields: ${missing.join(', ')}.`);
  }
}
