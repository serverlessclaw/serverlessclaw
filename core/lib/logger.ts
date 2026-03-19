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
 * A simple logger class for consistent logging across the application.
 */
class Logger {
  private level: LogLevel = LogLevel.INFO;

  /**
   * Initializes the logger by reading from environment variables.
   * Defaults to INFO level unless in a test environment.
   */
  constructor() {
    const logEnv = process.env.LOG_LEVEL;
    if (logEnv) {
      const levelStr = logEnv.toUpperCase();
      if (levelStr in LogLevel) {
        this.level = LogLevel[levelStr as keyof typeof LogLevel];
      }
    }

    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      this.level = process.env.DEBUG_TESTS ? LogLevel.DEBUG : LogLevel.NONE;
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
   * Logs a debug message.
   * @param message - The message to log.
   * @param args - Additional arguments for formatting or context.
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Logs an info message.
   * @param message - The message to log.
   * @param args - Additional arguments for formatting or context.
   */
  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * Logs a warning message.
   * @param message - The message to log.
   * @param args - Additional arguments for formatting or context.
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  /**
   * Logs an error message.
   * @param message - The message to log.
   * @param args - Additional arguments for formatting or context.
   */
  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  /**
   * Logs a generic message (defaults to INFO).
   * @param message - The message to log.
   * @param args - Additional arguments for formatting or context.
   */
  log(message: string, ...args: unknown[]): void {
    this.info(message, ...args);
  }
}

/**
 * Shared logger instance.
 */
export const logger = new Logger();
