/**
 * Chat-specific types for the dashboard
 * Re-exports shared types from core to avoid duplication
 */
import type { ConversationMeta } from '../../../../core/lib/types/memory';
export type { ConversationMeta };

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
}

export interface HistoryMessage {
  role: string;
  content: string;
  agentName?: string;
  attachments: ChatMessage['attachments'];
  options?: ChatMessage['options'];
}

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}
