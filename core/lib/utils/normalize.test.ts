import { describe, it, expect } from 'vitest';
import { normalizeBaseUserId, sanitizeMqttTopic } from './normalize';

describe('normalizeBaseUserId', () => {
  it('should return empty string for empty input', () => {
    expect(normalizeBaseUserId('')).toBe('');
  });

  it('should return "unknown" for null', () => {
    expect(normalizeBaseUserId(null)).toBe('unknown');
  });

  it('should return "unknown" for undefined', () => {
    expect(normalizeBaseUserId(undefined)).toBe('unknown');
  });

  it('should return "unknown" for non-string input', () => {
    expect(normalizeBaseUserId(123 as any)).toBe('unknown');
  });

  it('should strip CONV# prefix', () => {
    expect(normalizeBaseUserId('CONV#user123')).toBe('user123');
  });

  it('should return userId unchanged if no CONV# prefix', () => {
    expect(normalizeBaseUserId('user456')).toBe('user456');
  });

  it('should handle userId with multiple # characters after CONV#', () => {
    expect(normalizeBaseUserId('CONV#user#extra')).toBe('user');
  });
});

describe('sanitizeMqttTopic', () => {
  it('should return "unknown" for empty string', () => {
    expect(sanitizeMqttTopic('')).toBe('unknown');
  });

  it('should return "unknown" for falsy input', () => {
    expect(sanitizeMqttTopic(null as any)).toBe('unknown');
  });

  it('should replace # with underscore', () => {
    expect(sanitizeMqttTopic('topic#with#hash')).toBe('topic_with_hash');
  });

  it('should replace + with underscore', () => {
    expect(sanitizeMqttTopic('topic+with+plus')).toBe('topic_with_plus');
  });

  it('should replace both # and + with underscore', () => {
    expect(sanitizeMqttTopic('topic#+mixed')).toBe('topic__mixed');
  });

  it('should leave normal strings unchanged', () => {
    expect(sanitizeMqttTopic('normal-topic/path')).toBe('normal-topic/path');
  });
});
