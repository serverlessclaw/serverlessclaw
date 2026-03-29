import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCode } from './validation';

const { mockExecAsync } = vi.hoisted(() => {
  return {
    mockExecAsync: vi.fn(),
  };
});

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

describe('Validation Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateCode', () => {
    it('has correct tool definition', () => {
      expect(validateCode.name).toBe('validateCode');
      expect(validateCode.description).toBeDefined();
      expect(validateCode.parameters).toBeDefined();
    });

    it('has empty required parameters', () => {
      expect(validateCode.parameters.required).toEqual([]);
    });

    it('returns validation success when type check and lint pass', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'passed', stderr: '' });

      const result = await validateCode.execute();
      expect(result).toContain('TYPE_CHECK_PASSED');
    });

    it('handles validation failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('TypeScript error'));

      const result = await validateCode.execute();
      expect(result).toContain('VALIDATION_FAILED');
    });
  });
});
