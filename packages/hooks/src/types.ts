import type { ToolCall } from '@claw/core/lib/types/llm';

export interface PageContextData {
  url: string;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface DynamicComponent {
  id: string;
  componentType: string;
  props: Record<string, unknown>;
  actions?: {
    id: string;
    label: string;
    type: 'primary' | 'secondary' | 'danger';
    payload?: Record<string, unknown>;
  }[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  messageId?: string;
  agentName?: string;
  isError?: boolean;
  errorType?: 'busy' | 'connection' | 'process' | string;
  isQueued?: boolean;
  pendingMessageId?: string;
  attachments?: Array<{
    type: 'image' | 'file';
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
  options?: Array<{
    label: string;
    value: string;
    type?: 'primary' | 'secondary' | 'danger';
  }>;
  tool_calls?: ToolCall[];
  pageContext?: PageContextData;
  ui_blocks?: DynamicComponent[];
  isThinking?: boolean;
  createdAt?: number;
  modelName?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
}

export interface HistoryMessage {
  role: string;
  content: string;
  thought?: string;
  agentName?: string;
  traceId?: string;
  messageId?: string;
  attachments: ChatMessage['attachments'];
  options?: ChatMessage['options'];
  tool_calls?: ToolCall[];
  pageContext?: PageContextData;
  ui_blocks?: DynamicComponent[];
  createdAt?: number;
  modelName?: string;
  usage?: ChatMessage['usage'];
}

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}

export interface IncomingChunk {
  sessionId?: string;
  messageId?: string;
  message?: string;
  userId?: string;
  isThought?: boolean;
  thought?: string;
  agentName?: string;
  attachments?: ChatMessage['attachments'];
  options?: ChatMessage['options'];
  toolCalls?: ChatMessage['tool_calls'];
  tool_calls?: ChatMessage['tool_calls'];
  ui_blocks?: ChatMessage['ui_blocks'];
  pageContext?: ChatMessage['pageContext'];
  model?: string;
  modelName?: string;
  usage?: ChatMessage['usage'];
  createdAt?: number;
}
