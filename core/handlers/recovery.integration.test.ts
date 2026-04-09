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
    ConfigTable: { name: 'test-config-table' },
  },
}));

const healthMocks = vi.hoisted(() => ({
  checkCognitiveHealth: vi.fn(),
  reportHealthIssue: vi.fn(),
}));

vi.mock('../lib/lifecycle/health', () => ({
  checkCognitiveHealth: healthMocks.checkCognitiveHealth,
  reportHealthIssue: healthMocks.reportHealthIssue,
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Recovery Switch Integration', () => {
  beforeEach(() => {
    ddbMock.reset();
    codeBuildMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
    lockMocks.acquire.mockResolvedValue(true);
  });

  it('should execute full recovery flow: health check fail -> lock -> LKG -> CodeBuild rollback', async () => {
    healthMocks.checkCognitiveHealth.mockResolvedValue({
      ok: false,
      timestamp: Date.now(),
      results: {},
      summary: 'Critical failure',
    });
    memoryMocks.getLatestLKGHash.mockResolvedValue('abc12345');
    ddbMock.on(PutCommand).resolves({});
    codeBuildMock.on(StartBuildCommand).resolves({ build: { id: 'recovery-build-1' } });

    const { handler } = await import('./recovery');

    await handler();

    expect(lockMocks.acquire).toHaveBeenCalledWith('dead-mans-switch-recovery', {
      ownerId: 'recovery-handler',
      ttlSeconds: expect.any(Number),
    });

    expect(memoryMocks.getLatestLKGHash).toHaveBeenCalled();

    expect(codeBuildMock.commandCalls(StartBuildCommand)).toHaveLength(1);
    const buildInput = codeBuildMock.commandCalls(StartBuildCommand)[0].args[0].input;
    expect(buildInput.projectName).toBe('test-deployer');
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'EMERGENCY_ROLLBACK', value: 'true' })
    );
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'LKG_HASH', value: 'abc12345' })
    );

    expect(lockMocks.release).toHaveBeenCalledWith('dead-mans-switch-recovery', 'recovery-handler');
  });

  it('should persist health result to DynamoDB before checking status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    healthMocks.checkCognitiveHealth.mockResolvedValue({
      ok: false,
      timestamp: Date.now(),
      results: {},
      summary: 'Failure recorded',
    });
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
    memoryMocks.getLatestLKGHash.mockResolvedValue('def67890');
    ddbMock.on(PutCommand).resolves({});
    codeBuildMock.on(StartBuildCommand).resolves({});

    const { handler } = await import('./recovery');

    await handler();

    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls.length).toBeGreaterThanOrEqual(1);

    const healthPut = putCalls.find((call) =>
      call.args[0].input.Item?.userId?.startsWith('HEALTH#')
    );
    expect(healthPut).toBeDefined();
    expect(healthPut?.args[0].input.Item?.ok).toBe(false);
  });

  it('should skip rollback when lock cannot be acquired (recovery in progress)', async () => {
    lockMocks.acquire.mockResolvedValue(false);

    const { handler } = await import('./recovery');

    await handler();

    expect(codeBuildMock.commandCalls(StartBuildCommand)).toHaveLength(0);
    expect(memoryMocks.incrementRecoveryAttemptCount).not.toHaveBeenCalled();
  });

  it('should trigger circuit-breaker alert after MAX_RECOVERY_ATTEMPTS failures', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(5);
    ebMock.on(PutEventsCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('./recovery');

    await handler();

    expect(codeBuildMock.commandCalls(StartBuildCommand)).toHaveLength(0);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);

    const ebInput = ebMock.commandCalls(PutEventsCommand)[0].args[0].input;
    expect(ebInput.Entries![0].DetailType).toBe(EventType.OUTBOUND_MESSAGE);
    const detail = JSON.parse(ebInput.Entries![0].Detail!);
    expect(detail.message).toContain('CRITICAL SYSTEM FAILURE');
    expect(detail.message).toContain('5 attempts');
  });

  it('should fallback to empty LKG_HASH when no hash found in memory', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockResolvedValue(1);
    memoryMocks.getLatestLKGHash.mockResolvedValue(null);
    ddbMock.on(PutCommand).resolves({});
    codeBuildMock.on(StartBuildCommand).resolves({});

    const { handler } = await import('./recovery');

    await handler();

    const buildInput = codeBuildMock.commandCalls(StartBuildCommand)[0].args[0].input;
    expect(buildInput.environmentVariablesOverride).toContainEqual(
      expect.objectContaining({ name: 'LKG_HASH', value: '' })
    );
  });

  it('should release lock and throw when recovery flow throws error', async () => {
    lockMocks.acquire.mockResolvedValue(true);
    memoryMocks.incrementRecoveryAttemptCount.mockRejectedValue(new Error('DynamoDB Error'));

    const { handler } = await import('./recovery');

    await expect(handler()).rejects.toThrow('DynamoDB Error');

    expect(lockMocks.release).toHaveBeenCalledWith('dead-mans-switch-recovery', 'recovery-handler');
  });
});
