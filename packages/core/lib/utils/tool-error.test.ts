import { describe, it, expect } from 'vitest';
import { withToolError, successMessage, failureMessage } from './tool-error';

describe('withToolError', () => {
  it('should return result when executor succeeds', async () => {
    const result = await withToolError('test', async () => 'success');
    expect(result).toBe('success');
  });

  it('should return formatted error message when executor fails', async () => {
    const result = await withToolError('test', async () => {
      throw new Error('Something went wrong');
    });
    expect(result).toBe('test failed: Something went wrong');
  });

  it('should handle string errors', async () => {
    const result = await withToolError('test', async () => {
      throw 'String error';
    });
    expect(result).toBe('test failed: String error');
  });

  it('should handle null errors', async () => {
    const result = await withToolError('test', async () => {
      throw null;
    });
    expect(result).toBe('test failed: null');
  });

  it('should handle object errors', async () => {
    const result = await withToolError('test', async () => {
      throw { code: 'ERR001', message: 'Custom error' };
    });
    expect(result).toBe('test failed: [object Object]');
  });
});

describe('successMessage', () => {
  it('should format success message correctly', () => {
    expect(successMessage('deploy', 'Deployment complete')).toBe(
      'deploy successful: Deployment complete'
    );
  });

  it('should handle empty message', () => {
    expect(successMessage('test', '')).toBe('test successful: ');
  });
});

describe('failureMessage', () => {
  it('should format failure message from Error', () => {
    const error = new Error('Test error');
    expect(failureMessage('deploy', error)).toBe('deploy failed: Test error');
  });

  it('should format failure message from string', () => {
    expect(failureMessage('test', 'String error')).toBe('test failed: String error');
  });

  it('should format failure message from number', () => {
    expect(failureMessage('test', 404)).toBe('test failed: 404');
  });
});
