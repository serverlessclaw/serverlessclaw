import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';

const ddbMock = mockClient(DynamoDBDocumentClient);
const cbMock = mockClient(CodeBuildClient);

const memoryMocks = vi.hoisted(() => ({
  resetRecoveryAttemptCount: vi.fn().mockResolvedValue(undefined),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  releaseGapLock: vi.fn().mockResolvedValue(true),
  updateGapStatus: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    resetRecoveryAttemptCount = () => memoryMocks.resetRecoveryAttemptCount();
    acquireGapLock = () => memoryMocks.acquireGapLock();
    releaseGapLock = () => memoryMocks.releaseGapLock();
    updateGapStatus = () => memoryMocks.updateGapStatus();
  },
}));

const busMocks = vi.hoisted(() => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/bus', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    emitEvent: busMocks.emitEvent,
  };
});

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'MemoryTable' },
    App: { name: 'serverlessclaw', stage: 'test' },
  },
}));

vi.mock('../lib/utils/topology', () => ({
  discoverSystemTopology: vi.fn().mockResolvedValue({ nodes: [] }),
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

const warmupMocks = vi.hoisted(() => ({
  smartWarmup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/warmup', () => ({
  WarmupManager: class {
    smartWarmup = (...args: any[]) => warmupMocks.smartWarmup(...args);
  },
}));

describe('BuildMonitor Recovery Success', () => {
  beforeEach(() => {
    cbMock.reset();
    ddbMock.reset();
    vi.clearAllMocks();
    process.env.WARM_UP_FUNCTIONS = '{"agent1":"arn1"}';
    process.env.MCP_SERVER_ARNS = '{"server1":"arn2"}';
  });

  it('should reset counters, trigger warmup, and notify Brain on recovery success', async () => {
    const { handler } = await import('./monitor');

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          id: 'recovery-build-123',
          environment: {
            environmentVariables: [
              { name: 'INITIATOR_USER_ID', value: 'admin' },
              { name: 'EMERGENCY_ROLLBACK', value: 'true' },
              { name: 'TRACE_ID', value: 't-rec-1' },
            ],
          },
        },
      ],
    } as any);

    const event = {
      detail: {
        'build-id': 'recovery-build-123',
        'project-name': 'deployer',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    // 1. Verify counters reset
    expect(memoryMocks.resetRecoveryAttemptCount).toHaveBeenCalled();

    // 2. Verify Brain notification
    expect(busMocks.emitEvent).toHaveBeenCalledWith(
      'system.recovery',
      'outbound_message',
      expect.objectContaining({
        message: expect.stringContaining('SYSTEM RESTORED'),
        metadata: expect.objectContaining({ isRecovery: true }),
      })
    );

    // 3. Verify post-recovery warmup
    expect(warmupMocks.smartWarmup).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'recovery-complete',
        warmedBy: 'recovery',
      })
    );
  });
});
