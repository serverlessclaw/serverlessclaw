/**
 * Log levels for controlling the verbosity of the logger.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

/**
 * Context for structured logging with correlation IDs.
 */
export interface LogContext {
  traceId?: string;
  sessionId?: string;
  agentId?: string;
  [key: string]: unknown;
}

/**
 * Strict version of LogContext where trace and session context are mandatory.
 */
export interface StrictLogContext extends LogContext {
  traceId: string;
  sessionId: string;
}
