import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndPushRecursion } from './events/shared';
import * as tracker from '../lib/recursion-tracker';

vi.mock('../lib/recursion-tracker', () => ({
  incrementRecursionDepth: vi.fn(),
  getRecursionLimit: vi.fn(),
}));

describe('Events Shared Recursion Guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should allow execution if depth is within limits', async () => {
    vi.mocked(tracker.getRecursionLimit).mockResolvedValue(15);
    vi.mocked(tracker.incrementRecursionDepth).mockResolvedValue(5);

    const result = await checkAndPushRecursion('trace-123', 'session-123', 'agent-123');

    expect(result).toBe(5);
    expect(tracker.incrementRecursionDepth).toHaveBeenCalledWith(
      'trace-123',
      'session-123',
      'agent-123',
      false
    );
  });

  it('should block execution if limit is reached', async () => {
    vi.mocked(tracker.getRecursionLimit).mockResolvedValue(15);
    // Boundary check: if limit is 15, depth 16 is a block
    vi.mocked(tracker.incrementRecursionDepth).mockResolvedValue(16);

    const result = await checkAndPushRecursion('trace-123', 'session-123', 'agent-123');

    expect(result).toBeNull();
  });

  it('should use mission-specific limit when isMission is true', async () => {
    vi.mocked(tracker.getRecursionLimit).mockResolvedValue(10);
    vi.mocked(tracker.incrementRecursionDepth).mockResolvedValue(5);

    await checkAndPushRecursion('trace-123', 'session-123', 'agent-123', true);

    expect(tracker.getRecursionLimit).toHaveBeenCalledWith(true);
    expect(tracker.incrementRecursionDepth).toHaveBeenCalledWith(
      'trace-123',
      'session-123',
      'agent-123',
      true
    );
  });

  it('should block on database error (-1)', async () => {
    vi.mocked(tracker.getRecursionLimit).mockResolvedValue(15);
    vi.mocked(tracker.incrementRecursionDepth).mockResolvedValue(-1);

    const result = await checkAndPushRecursion('trace-123', 'session-123', 'agent-123');

    expect(result).toBeNull();
  });
});
