import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, LogLevel } from './logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('warning message');
      expect(console.warn).toHaveBeenCalledWith('[WARN] warning message');
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.error('error message');
      expect(console.error).toHaveBeenCalledWith('[ERROR] error message');
    });
  });

  describe('log', () => {
    it('should log as info by default', () => {
      logger.setLevel(LogLevel.INFO);
      logger.log('log message');
      expect(console.info).toHaveBeenCalledWith('[INFO] log message');
    });
  });
});
