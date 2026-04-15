/**
 * Chat-specific types for the dashboard
 */
import type { ToolCall } from '@claw/core/lib/types/llm';
import { PageContextData } from '../../types/page-context';
export type { ToolCall, PageContextData };

/**
 * Schema for dynamic operational components rendered in the chat.
 */
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
  /** Whether this message is queued for processing (not yet delivered to agent) */
  isQueued?: boolean;
  /** The pending message ID for queued messages (used for edit/remove) */
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
  /** Optional page context attached by the user */
  pageContext?: PageContextData;
  /** Optional dynamic UI blocks rendered by the assistant */
  ui_blocks?: DynamicComponent[];
}

export interface HistoryMessage {
  role: string;
  content: string;
  thought?: string;
  agentName?: string;
  traceId?: string; // Added for reconciliation
  messageId?: string; // Explicit identifier for distinct agent responses
  attachments: ChatMessage['attachments'];
  options?: ChatMessage['options'];
  tool_calls?: ToolCall[];
  pageContext?: PageContextData;
  ui_blocks?: DynamicComponent[];
}

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}
