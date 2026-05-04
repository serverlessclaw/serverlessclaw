import { describe, it, expect } from 'vitest';
import { formatErrorMessage, formatPrefixedError } from './error';

describe('formatErrorMessage', () => {
  it('should return message from Error instance', () => {
    const error = new Error('Test error message');
    expect(formatErrorMessage(error)).toBe('Test error message');
  });

  it('should convert string to string', () => {
    expect(formatErrorMessage('String error')).toBe('String error');
  });

  it('should convert number to string', () => {
    expect(formatErrorMessage(42)).toBe('42');
  });

  it('should convert null to string', () => {
    expect(formatErrorMessage(null)).toBe('null');
  });

  it('should convert undefined to string', () => {
    expect(formatErrorMessage(undefined)).toBe('undefined');
  });

  it('should convert object to string', () => {
    expect(formatErrorMessage({ key: 'value' })).toBe('[object Object]');
  });

  it('should handle empty error message', () => {
    const error = new Error('');
    expect(formatErrorMessage(error)).toBe('');
  });
});

describe('formatPrefixedError', () => {
  it('should prefix Error instance message', () => {
    const error = new Error('Original error');
    expect(formatPrefixedError('Failed operation', error)).toBe('Failed operation: Original error');
  });

  it('should prefix string error', () => {
    expect(formatPrefixedError('Failed operation', 'String error')).toBe(
      'Failed operation: String error'
    );
  });

  it('should prefix number error', () => {
    expect(formatPrefixedError('Failed operation', 404)).toBe('Failed operation: 404');
  });

  it('should handle empty prefix', () => {
    const error = new Error('Test');
    expect(formatPrefixedError('', error)).toBe(': Test');
  });

  it('should handle empty error message', () => {
    const error = new Error('');
    expect(formatPrefixedError('Error', error)).toBe('Error: ');
  });
});
