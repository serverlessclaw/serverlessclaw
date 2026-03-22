import { ReasoningProfile, TraceSource } from '../types/index';

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
  nodeId?: string;
  parentId?: string;
  sessionId?: string;
  attachments?: Array<{
    type: 'image' | 'file';
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
}
