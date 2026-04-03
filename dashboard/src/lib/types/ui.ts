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

export interface TraceStepContent {
  tool?: string;
  toolName?: string;
  result?: unknown; // result can be anything (images, objects, strings)
  content?: string;
  tool_calls?: { function: { name: string; arguments: string } }[];
  response?: string;
  messages?: { role: string; content: string }[];
  agentId?: string;
  userText?: string;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
  };
  args?: Record<string, unknown>;
  model?: string;
  errorMessage?: string;
  question?: string;
  originalTask?: string;
  retryCount?: number;
  depth?: number;
  taskCount?: number;
  tasks?: { taskId: string; agentId: string; task: string }[];
  aggregationType?: string;
  barrierTimeoutMs?: number;
  status?: string;
  targetTime?: string;
  reviewType?: string;
  direction?: 'to_initiator' | 'to_agent';
  initiatorId?: string;
  requestingAgent?: string;
  previousState?: string;
  newState?: string;
  failureType?: string;
  failureCount?: number;
  taskId?: string;
  operation?: string;
  key?: string;
  scope?: string;
  reflection?: string;
  reason?: string;
  stepId?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface TraceStep {
  stepId: string;
  timestamp: number;
  type: string;
  content: TraceStepContent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
}

export interface Trace {
  traceId: string;
  userId?: string;
  status: 'completed' | 'started' | 'error';
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
}
