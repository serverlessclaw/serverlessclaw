/**
 * Chat-specific types for the dashboard
 * Re-exports shared types from core to avoid duplication
 */
import type { ConversationMeta } from '../../../core/lib/types/memory';
export type { ConversationMeta };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  messageId?: string;
  agentName?: string;
  attachments?: Array<{
    type: 'image' | 'file';
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
}

export interface HistoryMessage {
  role: string;
  content: string;
  agentName?: string;
  attachments: ChatMessage['attachments'];
}

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}
