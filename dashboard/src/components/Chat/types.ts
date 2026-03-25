/**
 * Chat-specific types for the dashboard
 * Re-exports shared types from core to avoid duplication
 */
import type { ConversationMeta } from '../../../../core/lib/types/memory';
import type { ToolCall } from '../../../../core/lib/types/llm';
export type { ConversationMeta, ToolCall };

export interface PendingMessage {
  id: string;
  content: string;
  timestamp: number;
  attachments?: Array<{
    type: 'image' | 'file';
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
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
}

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}
