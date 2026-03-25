/**
 * Session-related types shared across core and dashboard
 */

import { AttachmentType } from './llm';

export interface PendingMessage {
  id: string;
  content: string;
  timestamp: number;
  attachments?: Array<{
    type: AttachmentType;
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
}
