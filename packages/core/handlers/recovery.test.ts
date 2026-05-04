import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventType } from '../lib/types/agent';

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
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    getLatestLKGHash = memoryMocks.getLatestLKGHash;
    incrementRecoveryAttemptCount = memoryMocks.incrementRecoveryAttemptCount;
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

describe('Dead Man Switch Recovery Handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    codeBuildMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
  });

  it('should NOT trigger CodeBuild if health check passes', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { handler } = await import('./recovery');
    await handler();
    expect(codeBuildMock.calls()).toHaveLength(0);
  });

  it('should circuit-break after MAX_ATTEMPTS and send alert', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(5); // 5 > 4 (MAX_RECOVERY_ATTEMPTS)
    ebMock.on(PutEventsCommand).resolves({});

    const { handler } = await import('./recovery');
    await handler();

    expect(codeBuildMock.commandCalls(StartBuildCommand)).toHaveLength(0);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);
    const ebInput = ebMock.commandCalls(PutEventsCommand)[0].args[0].input;
    expect(ebInput.Entries![0].DetailType).toBe(EventType.OUTBOUND_MESSAGE);
    expect(ebInput.Entries![0].Detail).toContain('🚨 *CRITICAL SYSTEM FAILURE*');
  });

  it('should retrieve LKG hash and trigger CodeBuild on health failure', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
    memoryMocks.getLatestLKGHash.mockResolvedValue('deadbeef1234567890');
    ddbMock.on(PutCommand).resolves({});
    codeBuildMock.on(StartBuildCommand).resolves({ build: { id: 'test-build' } });

    const { handler } = await import('./recovery');
    await handler();

    expect(memoryMocks.getLatestLKGHash).toHaveBeenCalled();
    expect(codeBuildMock.commandCalls(StartBuildCommand)).toHaveLength(1);
    const buildInput = codeBuildMock.commandCalls(StartBuildCommand)[0].args[0].input;
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'LKG_HASH', value: 'deadbeef1234567890' })
    );
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'EMERGENCY_ROLLBACK', value: 'true' })
    );
  });

  it('should fallback to empty LKG_HASH if none found in memory', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.getLatestLKGHash.mockResolvedValue(null);
    ddbMock.on(PutCommand).resolves({});
    codeBuildMock.on(StartBuildCommand).resolves({ build: { id: 'test-build' } });

    const { handler } = await import('./recovery');
    await handler();

    const buildInput = codeBuildMock.commandCalls(StartBuildCommand)[0].args[0].input;
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'LKG_HASH', value: '' })
    );
  });

  it('should log error but continue if EventBridge escalation fails', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(5);
    ebMock.on(PutEventsCommand).rejects(new Error('EventBridge Down'));
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('./recovery');
    // Should not throw - retry logic will attempt multiple times
    await expect(handler()).resolves.not.toThrow();
    expect(ebMock.commandCalls(PutEventsCommand).length).toBeGreaterThanOrEqual(1);
  });

  it('should release lock and report health issue if any error occurs during recovery flow', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockRejectedValue(new Error('DynamoDB Error'));

    const { handler } = await import('./recovery');

    await expect(handler()).rejects.toThrow('DynamoDB Error');

    expect(lockMocks.release).toHaveBeenCalledWith('dead-mans-switch-recovery', 'recovery-handler');
  });

  it('should allow "dev" as a valid LKG hash and trigger CodeBuild', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
    memoryMocks.getLatestLKGHash.mockResolvedValue('dev');
    ddbMock.on(PutCommand).resolves({});
    codeBuildMock.on(StartBuildCommand).resolves({ build: { id: 'test-build-dev' } });

    const { handler } = await import('./recovery');
    await handler();

    expect(codeBuildMock.commandCalls(StartBuildCommand)).toHaveLength(1);
    const buildInput = codeBuildMock.commandCalls(StartBuildCommand)[0].args[0].input;
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'LKG_HASH', value: 'dev' })
    );
  });
});
