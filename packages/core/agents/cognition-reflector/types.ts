/**
 * Reflector Agent type definitions
 */

import type { Message } from '../../lib/types/index';

export interface ReflectorPayload {
  userId: string;
  conversation: Message[];
  traceId?: string;
  sessionId?: string;
  task?: string;
  initiatorId?: string;
  depth?: number;
}

export interface ReflectorEvent {
  detail?: ReflectorPayload;
  source?: string;
}
