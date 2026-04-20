import { LogLevel, LogContext } from './types/logger';

// LogLevel and LogContext moved to types/logger.ts

/**
 * A simple logger class for consistent logging across the application.
 */
class Logger {
  private level: LogLevel = LogLevel.INFO;
  private defaultContext: LogContext = {};

  /**
   * Initializes the logger by reading from environment variables.
   * Defaults to INFO level unless in a test environment.
   */
  constructor() {
    // Check if process and process.env exist for browser compatibility
    const env = (typeof process !== 'undefined' ? process.env : {}) as any;

    const logEnv = env.LOG_LEVEL;
    if (logEnv) {
      const levelStr = logEnv.toUpperCase();
      if (levelStr in LogLevel) {
        this.level = LogLevel[levelStr as keyof typeof LogLevel];
      }
    }

    if (env.NODE_ENV === 'test' || env.VITEST) {
      this.level = env.DEBUG_TESTS ? LogLevel.DEBUG : LogLevel.NONE;
    }
  }

  /**
   * Manually sets the logging level.
   * @param level - The new LogLevel to set.
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Sets default context that will be included in all log messages.
   * @param context - The default context to set.
   */
  setDefaultContext(context: LogContext): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * Formats a log message with context.
   * @param level - The log level string.
   * @param message - The message to log.
   * @param context - Optional context for this specific log entry.
   * @param args - Additional arguments for formatting or context.
   * @returns Formatted log parts.
   */
  private formatLog(
    level: string,
    message: string,
    context?: LogContext,
    ...args: unknown[]
  ): { prefix: string; message: string; context?: LogContext; args: unknown[] } {
    const mergedContext = { ...this.defaultContext, ...context };
    const hasContext = Object.keys(mergedContext).length > 0;

    return {
      prefix: `[${level}]`,
      message,
      context: hasContext ? mergedContext : undefined,
      args,
    };
  }

  /**
   * Outputs a log message to the console.
   * @param consoleMethod - The console method to use.
   * @param level - The log level string.
   * @param message - The message to log.
   * @param context - Optional context for this specific log entry.
   * @param args - Additional arguments for formatting or context.
   */
  private output(
    consoleMethod: 'debug' | 'info' | 'warn' | 'error',
    level: string,
    message: string,
    context?: LogContext,
    ...args: unknown[]
  ): void {
    const formatted = this.formatLog(level, message, context, ...args);

    if (formatted.context) {
      console[consoleMethod](
        `${formatted.prefix} ${formatted.message}`,
        formatted.context,
        ...formatted.args
      );
    } else {
      console[consoleMethod](`${formatted.prefix} ${formatted.message}`, ...formatted.args);
    }
  }

  /**
   * Logs a debug message.
   * @param message - The message or object to log.
   * @param contextOrArgs - Either a LogContext object or additional arguments.
   * @param args - Additional arguments if context was provided.
   */
  debug(message: unknown, contextOrArgs?: LogContext | unknown, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const msg = typeof message === 'string' ? message : String(message);
      if (
        contextOrArgs &&
        typeof contextOrArgs === 'object' &&
        !Array.isArray(contextOrArgs) &&
        ('traceId' in contextOrArgs ||
          'sessionId' in contextOrArgs ||
          'agentId' in contextOrArgs ||
          Object.keys(contextOrArgs).length > 0)
      ) {
        this.output('debug', 'DEBUG', msg, contextOrArgs as LogContext, ...args);
      } else if (contextOrArgs !== undefined) {
        this.output('debug', 'DEBUG', msg, undefined, contextOrArgs, ...args);
      } else {
        this.output('debug', 'DEBUG', msg, undefined, ...args);
      }
    }
  }

  /**
   * Logs an info message.
   * @param message - The message or object to log.
   * @param contextOrArgs - Either a LogContext object or additional arguments.
   * @param args - Additional arguments if context was provided.
   */
  info(message: unknown, contextOrArgs?: LogContext | unknown, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      const msg = typeof message === 'string' ? message : String(message);
      if (
        contextOrArgs &&
        typeof contextOrArgs === 'object' &&
        !Array.isArray(contextOrArgs) &&
        ('traceId' in contextOrArgs ||
          'sessionId' in contextOrArgs ||
          'agentId' in contextOrArgs ||
          Object.keys(contextOrArgs).length > 0)
      ) {
        this.output('info', 'INFO', msg, contextOrArgs as LogContext, ...args);
      } else if (contextOrArgs !== undefined) {
        this.output('info', 'INFO', msg, undefined, contextOrArgs, ...args);
      } else {
        this.output('info', 'INFO', msg, undefined, ...args);
      }
    }
  }

  /**
   * Logs a warning message.
   * @param message - The message or object to log.
   * @param contextOrArgs - Either a LogContext object or additional arguments.
   * @param args - Additional arguments if context was provided.
   */
  warn(message: unknown, contextOrArgs?: LogContext | unknown, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      const msg = typeof message === 'string' ? message : String(message);
      if (
        contextOrArgs &&
        typeof contextOrArgs === 'object' &&
        !Array.isArray(contextOrArgs) &&
        ('traceId' in contextOrArgs ||
          'sessionId' in contextOrArgs ||
          'agentId' in contextOrArgs ||
          Object.keys(contextOrArgs).length > 0)
      ) {
        this.output('warn', 'WARN', msg, contextOrArgs as LogContext, ...args);
      } else if (contextOrArgs !== undefined) {
        this.output('warn', 'WARN', msg, undefined, contextOrArgs, ...args);
      } else {
        this.output('warn', 'WARN', msg, undefined, ...args);
      }
    }
  }

  /**
   * Logs an error message.
   * @param message - The message or object to log.
   * @param contextOrArgs - Either a LogContext object or additional arguments.
   * @param args - Additional arguments if context was provided.
   */
  error(message: unknown, contextOrArgs?: LogContext | unknown, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      const msg = typeof message === 'string' ? message : String(message);
      if (
        contextOrArgs &&
        typeof contextOrArgs === 'object' &&
        !Array.isArray(contextOrArgs) &&
        ('traceId' in contextOrArgs ||
          'sessionId' in contextOrArgs ||
          'agentId' in contextOrArgs ||
          Object.keys(contextOrArgs).length > 0)
      ) {
        this.output('error', 'ERROR', msg, contextOrArgs as LogContext, ...args);
      } else if (contextOrArgs !== undefined) {
        this.output('error', 'ERROR', msg, undefined, contextOrArgs, ...args);
      } else {
        this.output('error', 'ERROR', msg, undefined, ...args);
      }
    }
  }

  /**
   * Logs a generic message (defaults to INFO).
   * @param message - The message or object to log.
   * @param contextOrArgs - Either a LogContext object or additional arguments.
   * @param args - Additional arguments if context was provided.
   */
  log(message: unknown, contextOrArgs?: LogContext | unknown, ...args: unknown[]): void {
    this.info(message, contextOrArgs, ...args);
  }
}

/**
 * Shared logger instance.
 */
export const logger = new Logger();

/**
 * Creates a logger instance with preset context for traceId correlation.
 * @param traceId - The trace ID for correlating logs.
 * @param sessionId - Optional session ID.
 * @param agentId - Optional agent ID.
 * @returns A logger instance with preset context.
 */
export function createLogger(
  traceId: string,
  sessionId?: string,
  agentId?: string
): Pick<Logger, 'debug' | 'info' | 'warn' | 'error' | 'log'> {
  const context: LogContext = { traceId };
  if (sessionId) context.sessionId = sessionId;
  if (agentId) context.agentId = agentId;

  return {
    debug: (message: string, ...args: unknown[]) => logger.debug(message, context, ...args),
    info: (message: string, ...args: unknown[]) => logger.info(message, context, ...args),
    warn: (message: string, ...args: unknown[]) => logger.warn(message, context, ...args),
    error: (message: string, ...args: unknown[]) => logger.error(message, context, ...args),
    log: (message: string, ...args: unknown[]) => logger.log(message, context, ...args),
  };
}
