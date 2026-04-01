import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, createLogger } from './logger';
import { LogLevel } from './types/logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logger['defaultContext'] = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LogLevel enum', () => {
    it('should have correct numeric values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
      expect(LogLevel.NONE).toBe(4);
    });
  });

  describe('setLevel', () => {
    it('should set the logging level', () => {
      logger.setLevel(LogLevel.DEBUG);
      expect(logger['level']).toBe(LogLevel.DEBUG);
    });

    it('should allow changing to ERROR level', () => {
      logger.setLevel(LogLevel.ERROR);
      expect(logger['level']).toBe(LogLevel.ERROR);
    });

    it('should allow changing to NONE level', () => {
      logger.setLevel(LogLevel.NONE);
      logger.info('should not appear');
      expect(console.info).not.toHaveBeenCalled();
    });
  });

  describe('debug', () => {
    it('should log debug messages when level is DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('test message', { data: 'value' });
      expect(console.debug).toHaveBeenCalledWith('[DEBUG] test message', { data: 'value' });
    });

    it('should not log when level is higher than DEBUG', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.debug('test message');
      expect(console.debug).not.toHaveBeenCalled();
    });

    it('should handle additional args with context', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('msg', { traceId: 't1' }, 'extra');
      expect(console.debug).toHaveBeenCalledWith('[DEBUG] msg', { traceId: 't1' }, 'extra');
    });

    it('should handle additional args without context', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('msg', 'arg1', 'arg2');
      expect(console.debug).toHaveBeenCalledWith('[DEBUG] msg', 'arg1', 'arg2');
    });

    it('should handle array as first arg (not context)', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('msg', [1, 2, 3]);
      expect(console.debug).toHaveBeenCalledWith('[DEBUG] msg', [1, 2, 3]);
    });

    it('should handle empty object as context', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('msg', {});
      expect(console.debug).toHaveBeenCalledWith('[DEBUG] msg', {});
    });
  });

  describe('info', () => {
    it('should log info messages when level is INFO', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('test message');
      expect(console.info).toHaveBeenCalledWith('[INFO] test message');
    });

    it('should not log when level is higher than INFO', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.info('test message');
      expect(console.info).not.toHaveBeenCalled();
    });

    it('should log with context object', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('test', { sessionId: 's1' });
      expect(console.info).toHaveBeenCalledWith('[INFO] test', { sessionId: 's1' });
    });

    it('should log with agentId context', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('test', { agentId: 'agent-1' });
      expect(console.info).toHaveBeenCalledWith('[INFO] test', { agentId: 'agent-1' });
    });

    it('should log with generic object context', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('test', { customKey: 'customValue' });
      expect(console.info).toHaveBeenCalledWith('[INFO] test', { customKey: 'customValue' });
    });

    it('should handle additional args after context', () => {
      logger.setLevel(LogLevel.INFO);
      logger.info('msg', { traceId: 't1' }, 'extra1', 'extra2');
      expect(console.info).toHaveBeenCalledWith(
        '[INFO] msg',
        { traceId: 't1' },
        'extra1',
        'extra2'
      );
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('warning message');
      expect(console.warn).toHaveBeenCalledWith('[WARN] warning message');
    });

    it('should not log when level is ERROR', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.warn('warning');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should log with context', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('warning', { traceId: 't1' });
      expect(console.warn).toHaveBeenCalledWith('[WARN] warning', { traceId: 't1' });
    });

    it('should handle args without context', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('warning', 'extra');
      expect(console.warn).toHaveBeenCalledWith('[WARN] warning', 'extra');
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('error message');
      expect(console.error).toHaveBeenCalledWith('[ERROR] error message');
    });

    it('should always log errors when level is ERROR', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('critical error');
      expect(console.error).toHaveBeenCalledWith('[ERROR] critical error');
    });

    it('should log with context', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('error', { agentId: 'agent-1', traceId: 't1' });
      expect(console.error).toHaveBeenCalledWith('[ERROR] error', {
        agentId: 'agent-1',
        traceId: 't1',
      });
    });

    it('should handle args without context', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('error', 'detail1', 'detail2');
      expect(console.error).toHaveBeenCalledWith('[ERROR] error', 'detail1', 'detail2');
    });
  });

  describe('log', () => {
    it('should log as info by default', () => {
      logger.setLevel(LogLevel.INFO);
      logger.log('log message');
      expect(console.info).toHaveBeenCalledWith('[INFO] log message');
    });

    it('should not log when level is higher than INFO', () => {
      logger.setLevel(LogLevel.WARN);
      logger.log('log message');
      expect(console.info).not.toHaveBeenCalled();
    });
  });

  describe('formatLog', () => {
    it('should include context when provided', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.info('test', { traceId: 'abc' });

      expect(console.info).toHaveBeenCalledWith('[INFO] test', { traceId: 'abc' });
    });

    it('should merge default context', () => {
      logger.setDefaultContext({ traceId: 'default-trace' });
      logger.setLevel(LogLevel.DEBUG);
      logger.info('test', { sessionId: 's1' });

      expect(console.info).toHaveBeenCalledWith('[INFO] test', {
        traceId: 'default-trace',
        sessionId: 's1',
      });
    });

    it('should merge default context with specific context', () => {
      logger.setDefaultContext({ agentId: 'default-agent' });
      logger.setLevel(LogLevel.DEBUG);
      logger.warn('test');

      expect(console.warn).toHaveBeenCalledWith('[WARN] test', { agentId: 'default-agent' });
    });
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.setLevel(LogLevel.DEBUG);
    logger['defaultContext'] = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a logger with traceId context', () => {
    const log = createLogger('trace-1');

    log.info('test message');

    expect(console.info).toHaveBeenCalledWith('[INFO] test message', { traceId: 'trace-1' });
  });

  it('should include sessionId in context', () => {
    const log = createLogger('trace-1', 'session-1');

    log.info('test');

    expect(console.info).toHaveBeenCalledWith('[INFO] test', {
      traceId: 'trace-1',
      sessionId: 'session-1',
    });
  });

  it('should include agentId in context', () => {
    const log = createLogger('trace-1', 'session-1', 'agent-1');

    log.info('test');

    expect(console.info).toHaveBeenCalledWith('[INFO] test', {
      traceId: 'trace-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
    });
  });

  it('should work with debug method', () => {
    const log = createLogger('trace-1');
    log.debug('debug msg');
    expect(console.debug).toHaveBeenCalledWith('[DEBUG] debug msg', { traceId: 'trace-1' });
  });

  it('should work with warn method', () => {
    const log = createLogger('trace-1');
    log.warn('warn msg');
    expect(console.warn).toHaveBeenCalledWith('[WARN] warn msg', { traceId: 'trace-1' });
  });

  it('should work with error method', () => {
    const log = createLogger('trace-1');
    log.error('error msg');
    expect(console.error).toHaveBeenCalledWith('[ERROR] error msg', { traceId: 'trace-1' });
  });

  it('should work with log method', () => {
    const log = createLogger('trace-1');
    log.log('log msg');
    expect(console.info).toHaveBeenCalledWith('[INFO] log msg', { traceId: 'trace-1' });
  });

  it('should pass additional args to debug', () => {
    const log = createLogger('trace-1');
    log.debug('msg', 'extra');
    expect(console.debug).toHaveBeenCalledWith('[DEBUG] msg', { traceId: 'trace-1' }, 'extra');
  });

  it('should pass additional args to info', () => {
    const log = createLogger('trace-1');
    log.info('msg', 'extra1', 'extra2');
    expect(console.info).toHaveBeenCalledWith(
      '[INFO] msg',
      { traceId: 'trace-1' },
      'extra1',
      'extra2'
    );
  });

  it('should pass additional args to warn', () => {
    const log = createLogger('trace-1');
    log.warn('msg', 'extra');
    expect(console.warn).toHaveBeenCalledWith('[WARN] msg', { traceId: 'trace-1' }, 'extra');
  });

  it('should pass additional args to error', () => {
    const log = createLogger('trace-1');
    log.error('msg', 'extra');
    expect(console.error).toHaveBeenCalledWith('[ERROR] msg', { traceId: 'trace-1' }, 'extra');
  });
});
