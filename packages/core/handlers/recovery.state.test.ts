import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

const ddbMock = mockClient(DynamoDBDocumentClient);
const codeBuildMock = mockClient(CodeBuildClient);
const ebMock = mockClient(EventBridgeClient);

const lockMocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn().mockResolvedValue(true),
  renew: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/lock/lock-manager', () => ({
  LockManager: class {
    acquire = lockMocks.acquire;
    release = lockMocks.release;
    renew = lockMocks.renew;
  },
}));

const memoryMocks = vi.hoisted(() => ({
  getLatestLKGHash: vi.fn(),
  incrementRecoveryAttemptCount: vi.fn(),
  resetRecoveryAttemptCount: vi.fn(),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    getLatestLKGHash = memoryMocks.getLatestLKGHash;
    incrementRecoveryAttemptCount = memoryMocks.incrementRecoveryAttemptCount;
    resetRecoveryAttemptCount = memoryMocks.resetRecoveryAttemptCount;
  },
}));

vi.mock('sst', () => ({
  Resource: {
    WebhookApi: { url: 'https://test.example.com' },
    Deployer: { name: 'test-deployer' },
    MemoryTable: { name: 'test-memory-table' },
    AgentBus: { name: 'test-bus' },
  },
}));

// Mock lifecycle health
vi.mock('../lib/lifecycle/health', () => ({
  checkCognitiveHealth: vi.fn().mockResolvedValue({ ok: true, summary: 'Optimal', results: {} }),
  reportHealthIssue: vi.fn().mockResolvedValue(undefined),
}));

describe('Dead Man Switch Recovery Handler Concurrency & State', () => {
  beforeEach(() => {
    ddbMock.reset();
    codeBuildMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
    memoryMocks.resetRecoveryAttemptCount.mockResolvedValue(undefined);
  });

  it('REPRO: should reset recovery attempts when health check passes', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { handler } = await import('./recovery');

    await handler();

    // This is EXPECTED to fail before the fix
    expect(memoryMocks.resetRecoveryAttemptCount).toHaveBeenCalled();
  });
});
