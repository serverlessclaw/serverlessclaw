import { ReasoningProfile, TraceSource, AttachmentType } from '../types/index';
import { SessionStateManager } from '../session-state';

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
}
