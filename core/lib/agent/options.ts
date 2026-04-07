import { ReasoningProfile, TraceSource, AttachmentType } from '../types/index';
import { SessionStateManager } from '../session/session-state';

/**
 * Timeout behavior when agent reaches its time limit.
 */
export type TimeoutBehavior = 'pause' | 'fail' | 'continue';

/**
 * Processing options for the agent's process method.
 */
export interface AgentProcessOptions {
  profile?: ReasoningProfile;
  context?: import('aws-lambda').Context;
  isContinuation?: boolean;
  isIsolated?: boolean;
  initiatorId?: string;
  depth?: number;
  traceId?: string;
  taskId?: string;
  nodeId?: string;
  parentId?: string;
  sessionId?: string;
  attachments?: Array<{
    type: AttachmentType;
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
  source?: TraceSource | string;
  responseFormat?: import('../types/index').ResponseFormat;
  communicationMode?: 'json' | 'text';
  /**
   * Per-task timeout in milliseconds. Overrides the default timeout.
   * Default: 300000 (5 minutes)
   */
  taskTimeoutMs?: number;
  /**
   * Behavior when agent times out. Default: 'pause'
   */
  timeoutBehavior?: TimeoutBehavior;
  /**
   * Session state manager for coordinating concurrent requests.
   * Enables pending message injection during long-running tasks.
   */
  sessionStateManager?: SessionStateManager;
  /**
   * List of tool call IDs that have been explicitly approved by the user.
   */
  approvedToolCalls?: string[];
  /** Sampling temperature (0.0 to 1.0). Controls randomness. */
  temperature?: number;
  /** Maximum tokens for the completion. */
  maxTokens?: number;
  /** Nucleus sampling probability (0.0 to 1.0). */
  topP?: number;
  /** Sequences where the LLM will stop generating. */
  stopSequences?: string[];
  /**
   * If true, ignores the human-in-control handoff status.
   * Useful for the primary orchestrator that is directly responding to a user command.
   */
  ignoreHandoff?: boolean;
  /**
   * Optional page context attached by the user (URL, title, page data, etc.)
   */
  pageContext?: {
    url: string;
    title?: string;
    data?: Record<string, unknown>;
    traceId?: string;
    sessionId?: string;
    agentId?: string;
  };
  /**
   * Maximum number of tokens the agent can consume in a single task.
   * If set, the executor will enforce this limit and stop if exceeded.
   */
  tokenBudget?: number;
  /**
   * Maximum cost (in USD) allowed for this task.
   * If set, the executor will track costs and stop if exceeded.
   */
  costLimit?: number;
  /**
   * Cumulative token usage from prior continuation invocations.
   */
  priorTokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
