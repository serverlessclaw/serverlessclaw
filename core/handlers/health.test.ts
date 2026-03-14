import { describe, it, expect, vi, beforeEach } from 'vitest';

const healthMocks = vi.hoisted(() => ({
  runDeepHealthCheck: vi.fn(),
}));

const memoryMocks = vi.hoisted(() => ({
  saveLKGHash: vi.fn(),
  resetRecoveryAttemptCount: vi.fn(),
}));

vi.mock('../lib/health', () => ({
  runDeepHealthCheck: healthMocks.runDeepHealthCheck,
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    saveLKGHash = memoryMocks.saveLKGHash;
    resetRecoveryAttemptCount = memoryMocks.resetRecoveryAttemptCount;
  },
}));

describe('Health Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GIT_HASH = 'test-hash';
  });

  it('should return 200 and save LKG/reset attempts if deep check passes', async () => {
    healthMocks.runDeepHealthCheck.mockResolvedValue({ ok: true });

    const { handler } = await import('./health');
    const result = await (handler as any)({}, {});

    expect(result.statusCode).toBe(200);
    expect(memoryMocks.saveLKGHash).toHaveBeenCalledWith('test-hash');
    expect(memoryMocks.resetRecoveryAttemptCount).toHaveBeenCalled();
    const body = JSON.parse(result.body);
    expect(body.status).toBe('ok');
    expect(body.gitHash).toBe('test-hash');
  });

  it('should return 200 but handle missing GIT_HASH gracefully', async () => {
    delete process.env.GIT_HASH;
    healthMocks.runDeepHealthCheck.mockResolvedValue({ ok: true });

    const { handler } = await import('./health');
    const result = await (handler as any)({}, {});

    expect(result.statusCode).toBe(200);
    expect(memoryMocks.resetRecoveryAttemptCount).toHaveBeenCalled();
    expect(memoryMocks.saveLKGHash).not.toHaveBeenCalled();
    const body = JSON.parse(result.body);
    expect(body.gitHash).toBe('unknown');
  });

  it('should return 503 if deep check fails', async () => {
    healthMocks.runDeepHealthCheck.mockResolvedValue({ ok: false, details: 'DynamoDB error' });

    const { handler } = await import('./health');
    const result = await (handler as any)({}, {});

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('error');
    expect(body.message).toContain('Deep health check failed');
  });

  it('should reset recovery attempts even if saveLKGHash fails', async () => {
    healthMocks.runDeepHealthCheck.mockResolvedValue({ ok: true });
    memoryMocks.saveLKGHash.mockRejectedValue(new Error('DynamoDB Write Error'));

    const { handler } = await import('./health');

    // We expect it to NOT throw and still return 200, or at least try to reset.
    // In current implementation, if any error happens in mid-handler it catches.
    const result = await (handler as any)({}, {});
    expect(result.statusCode).toBe(503); // It catches the error and returns 503
    expect(memoryMocks.resetRecoveryAttemptCount).toHaveBeenCalled();
  });
});
