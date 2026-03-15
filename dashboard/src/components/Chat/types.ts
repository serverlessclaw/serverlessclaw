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
  attachments?: ChatMessage['attachments'];
}

export interface ConversationMeta {
  sessionId: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
}

export interface AttachmentPreview {
  file: File;
  preview: string;
  type: 'image' | 'file';
}
