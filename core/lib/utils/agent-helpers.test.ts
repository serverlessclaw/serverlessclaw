import { describe, it, expect } from 'vitest';
import { extractBaseUserId, extractPayload, detectFailure, isTaskPaused } from './agent-helpers';

describe('extractBaseUserId', () => {
  it('should extract base userId when CONV# prefix is present', () => {
    expect(extractBaseUserId('CONV#user123')).toBe('user123');
  });

  it('should extract base userId from deep dashboard session identifiers', () => {
    expect(extractBaseUserId('CONV#dashboard-user#session_123')).toBe('dashboard-user');
  });

  it('should return original userId when no CONV# prefix', () => {
    expect(extractBaseUserId('user123')).toBe('user123');
  });

  it('should handle empty string', () => {
    expect(extractBaseUserId('')).toBe('');
  });
});

describe('extractPayload', () => {
  it('should extract payload from EventBridge event with detail wrapper', () => {
    const event = { detail: { userId: 'user123', message: 'hello' } };
    const result = extractPayload(event);
    expect(result).toEqual({ userId: 'user123', message: 'hello' });
  });

  it('should return direct payload when no detail wrapper', () => {
    const event = { userId: 'user123', message: 'hello' };
    const result = extractPayload(event);
    expect(result).toEqual({ userId: 'user123', message: 'hello' });
  });

  it('should handle empty event', () => {
    const event = {};
    const result = extractPayload(event);
    expect(result).toEqual({});
  });
});

describe('detectFailure', () => {
  it('should return true for internal error response', () => {
    expect(detectFailure('I encountered an internal error')).toBe(true);
  });

  it('should return false for normal response', () => {
    expect(detectFailure('Task completed successfully')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(detectFailure('')).toBe(false);
  });
});

describe('isTaskPaused', () => {
  it('should return true for TASK_PAUSED response', () => {
    expect(isTaskPaused('TASK_PAUSED')).toBe(true);
  });

  it('should return false for normal response', () => {
    expect(isTaskPaused('Task completed')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isTaskPaused('')).toBe(false);
  });
});
