export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  constructor() {
    if (process.env.LOG_LEVEL) {
      const levelStr = process.env.LOG_LEVEL.toUpperCase();
      if (levelStr in LogLevel) {
        this.level = LogLevel[levelStr as keyof typeof LogLevel];
      }
    }

    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      this.level = process.env.DEBUG_TESTS ? LogLevel.DEBUG : LogLevel.NONE;
    }
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]) {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  log(message: string, ...args: unknown[]) {
    this.info(message, ...args);
  }
}

export const logger = new Logger();
