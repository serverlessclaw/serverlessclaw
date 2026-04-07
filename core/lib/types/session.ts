/**
 * Session-related types shared across core and dashboard
 */

import type { Attachment } from './llm';

export interface PendingMessage {
  id: string;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}
