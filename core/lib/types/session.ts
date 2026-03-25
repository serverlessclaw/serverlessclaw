/**
 * Session-related types shared across core and dashboard
 */

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
