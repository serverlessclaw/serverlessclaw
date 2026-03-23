import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VALIDATE_CODE } from './validation';

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

  describe('VALIDATE_CODE', () => {
    it('has correct tool definition', () => {
      expect(VALIDATE_CODE.name).toBe('validateCode');
      expect(VALIDATE_CODE.description).toBeDefined();
      expect(VALIDATE_CODE.parameters).toBeDefined();
    });

    it('has empty required parameters', () => {
      expect(VALIDATE_CODE.parameters.required).toEqual([]);
    });

    it('returns validation success when type check and lint pass', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'passed', stderr: '' });

      const result = await VALIDATE_CODE.execute();
      expect(result).toContain('Validation Successful');
    });

    it('handles validation failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('TypeScript error'));

      const result = await VALIDATE_CODE.execute();
      expect(result).toContain('Validation FAILED');
    });
  });
});
