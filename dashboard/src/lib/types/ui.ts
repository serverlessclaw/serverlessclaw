/**
 * UI-only shared types for dashboard components
 * Keep lightweight to avoid bundling server-only core code into the client.
 */

export interface Tool {
  name: string;
  description: string;
  isExternal?: boolean;
  usage?: {
    count: number;
    lastUsed: number;
  };
}

export interface Agent {
  id: string;
  name: string;
  systemPrompt: string;
  provider?: string;
  model?: string;
  reasoningProfile?: string;
  enabled: boolean;
  tools: string[];
  isBackbone?: boolean;
  usage?: Record<string, { count: number; lastUsed: number }>;
}

export interface ProviderModel {
  label: string;
  models: string[];
}

export interface UsageInfo {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

export interface LlmCallContent {
  messages: { role: string; content: string }[];
  model?: string;
  usage?: UsageInfo;
}

export interface LlmResponseContent {
  content?: string;
  response?: string;
  tool_calls?: { function: { name: string; arguments: string } }[];
  usage?: UsageInfo;
  model?: string;
}

export interface ToolCallContent {
  tool?: string;
  toolName?: string;
  args: Record<string, unknown>;
  agentId?: string;
  connectorId?: string;
}

export interface ToolResultContent {
  result: unknown;
  tool?: string;
  toolName?: string;
  connectorId?: string;
}

export interface ErrorContent {
  errorMessage: string;
  agentId?: string;
}

export interface ClarificationContent {
  question: string;
  originalTask?: string;
  agentId?: string;
  retryCount?: number;
  depth?: number;
}

export interface ParallelDispatchContent {
  taskCount: number;
  tasks: { taskId: string; agentId: string; task: string }[];
  aggregationType?: string;
  barrierTimeoutMs?: number;
}

export interface ParallelBarrierContent {
  taskCount: number;
  status: string;
  targetTime?: string;
}

export interface CouncilReviewContent {
  reviewType: string;
  status: string;
}

export interface ContinuationContent {
  direction: 'to_initiator' | 'to_agent';
  initiatorId?: string;
  requestingAgent?: string;
}

export interface CircuitBreakerContent {
  previousState: string;
  newState: string;
  reason?: string;
  failureType?: string;
  failureCount?: number;
}

export interface CancellationContent {
  taskId?: string;
  initiatorId?: string;
  reason?: string;
}

export interface MemoryOperationContent {
  operation: string;
  key?: string;
  scope?: string;
}

export interface ReflectContent {
  reflection: string;
  agentId?: string;
}

export interface AgentStateContent {
  reason?: string;
  agentId?: string;
  question?: string;
}

export interface ResultContent {
  response: string;
}

export interface GenericContent {
  [key: string]: unknown;
}

export type TraceStep =
  | { stepId: string; timestamp: number; type: 'llm_call'; content: LlmCallContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'llm_response'; content: LlmResponseContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'tool_call'; content: ToolCallContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'tool_result' | 'tool_response'; content: ToolResultContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'error'; content: ErrorContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'clarification_request'; content: ClarificationContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'clarification_response'; content: GenericContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'parallel_dispatch'; content: ParallelDispatchContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'parallel_barrier'; content: ParallelBarrierContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'parallel_completed'; content: ParallelBarrierContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'council_review'; content: CouncilReviewContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'continuation'; content: ContinuationContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'circuit_breaker'; content: CircuitBreakerContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'cancellation'; content: CancellationContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'memory_operation'; content: MemoryOperationContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'reflect'; content: ReflectContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'agent_waiting' | 'agent_resumed'; content: AgentStateContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'result'; content: ResultContent; metadata: Record<string, unknown> }
  | { stepId: string; timestamp: number; type: 'trigger'; content: GenericContent; metadata: Record<string, unknown> };

/** Union of all possible trace content types for convenience. */
export type TraceStepContent = TraceStep['content'];

export interface Trace {
  traceId: string;
  userId?: string;
  status: 'completed' | 'started' | 'error' | 'failed' | 'paused';
  timestamp: number;
  source?: string;
  initialContext?: {
    userText?: string;
    sessionId?: string;
    agentId?: string;
    model?: string;
  };
  steps?: TraceStep[];
  finalResponse?: string;
  nodes?: Trace[];
  parentId?: string;
  nodeId: string;
  // Derived fields used in UI processing
  agentId?: string;
  totalTokens?: number;
  toolsUsed?: string[];
  model?: string;
  sessionId?: string;
  durationMs?: number;
}
