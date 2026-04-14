import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerSmartWarmup } from './warmup';

const mockSmartWarmup = vi.fn().mockResolvedValue(undefined);

// Mock WarmupManager
vi.mock('../warmup/warmup-manager', () => ({
  WarmupManager: class {
    smartWarmup = mockSmartWarmup;
  },
}));

describe('Smart Warmup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('triggers warmup at depth 0 in Lambda environment', async () => {
    process.env.LAMBDA_TASK_ROOT = '/var/task';
    process.env.MCP_SERVER_ARNS = JSON.stringify({ test: 'arn' });

    triggerSmartWarmup('hello', 0);

    // It's async/fire-and-forget, so we need to wait a bit for the dynamic import
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSmartWarmup).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'hello',
      })
    );
  });

  it('does NOT trigger warmup when depth > 0', async () => {
    process.env.LAMBDA_TASK_ROOT = '/var/task';
    triggerSmartWarmup('hello', 1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSmartWarmup).not.toHaveBeenCalled();
  });

  it('does NOT trigger warmup when not in Lambda', async () => {
    delete process.env.LAMBDA_TASK_ROOT;
    triggerSmartWarmup('hello', 0);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockSmartWarmup).not.toHaveBeenCalled();
  });
});
