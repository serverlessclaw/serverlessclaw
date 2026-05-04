/**
 * Shared mock for the logger module.
 * Usage: vi.mock('../lib/logger', () => import('./__mocks__/logger'));
 */
import { vi } from 'vitest';

export const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
