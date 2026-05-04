import { EventType } from '../../types/index';

export enum EventPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}

export enum ErrorCategory {
  TRANSIENT = 'TRANSIENT',
  PERMANENT = 'PERMANENT',
  UNKNOWN = 'UNKNOWN',
}

export interface EventOptions {
  priority?: EventPriority;
  idempotencyKey?: string;
  maxRetries?: number;
  correlationId?: string;
}

export interface DlqEntry {
  userId: string; // The partition key (EVENTBUS#DLQ#...)
  timestamp: number; // The range key
  type: string; // DLQ_EVENT
  source: string;
  detailType: string;
  detail: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  errorCategory?: ErrorCategory;
  priority: EventPriority;
  correlationId?: string;
  createdAt: number;
  expiresAt: number;
  workspaceId?: string;
}

export { EventType };
