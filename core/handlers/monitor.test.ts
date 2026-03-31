import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { GapStatus } from '../lib/types/agent';

const ddbMock = mockClient(DynamoDBDocumentClient);
const cbMock = mockClient(CodeBuildClient);
const cwMock = mockClient(CloudWatchLogsClient);

const memoryMocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  incrementGapAttemptCount: vi.fn(),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    updateGapStatus = memoryMocks.updateGapStatus;
    incrementGapAttemptCount = memoryMocks.incrementGapAttemptCount;
    updateDistilledMemory = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(0),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/lifecycle/health', () => ({
  reportHealthIssue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/topology', () => ({
  discoverSystemTopology: vi.fn().mockResolvedValue({ nodes: [] }),
}));

vi.mock('../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  EventPriority: {
    LOW: 0,
    NORMAL: 1,
    HIGH: 2,
    CRITICAL: 3,
  },
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
    AgentBus: { name: 'test-bus' },
    Deployer: { name: 'test-deployer' },
  },
}));

const makeFailEvent = (buildId: string) => ({
  detail: {
    'build-id': buildId,
    'project-name': 'test-project',
    'build-status': 'FAILED',
  },
});

const SUCCESS_META = { initiatorUserId: 'user-1', task: 'test', traceId: 't1' };

describe('BuildMonitor — FAILED gap handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    cwMock.reset();
    vi.clearAllMocks();

    // Build metadata
    ddbMock.on(QueryCommand).resolves({
      Items: [SUCCESS_META],
    });
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [{ logs: { groupName: '/aws/test', streamName: 'stream-1' } }],
    });
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'Error: build failed' }] });
  });

  it('should REOPEN a gap when attempt count is below the cap', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1); // first attempt
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ ...SUCCESS_META, initiatorUserId: 'user-1' }] }) // build meta
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1001']) }] }); // gap meta

    const { handler } = await import('./monitor');
    await handler(makeFailEvent('build-1') as unknown as Parameters<typeof handler>[0]);

    expect(memoryMocks.incrementGapAttemptCount).toHaveBeenCalledWith('GAP#1001');
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.OPEN);
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1001', GapStatus.FAILED);
  });

  it('should FAIL a gap when attempt count reaches the cap (3)', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(3); // cap reached
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ ...SUCCESS_META, initiatorUserId: 'user-1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1002']) }] });

    const { handler } = await import('./monitor');
    await handler(makeFailEvent('build-2') as unknown as Parameters<typeof handler>[0]);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1002', GapStatus.FAILED);
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1002', GapStatus.OPEN);
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1002', GapStatus.ARCHIVED);
  });

  it('should never set a gap to GapStatus.ARCHIVED immediately on failure', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1);
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ ...SUCCESS_META, initiatorUserId: 'user-1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1003']) }] });

    const { handler } = await import('./monitor');
    await handler(makeFailEvent('build-3') as unknown as Parameters<typeof handler>[0]);

    const archivedCalls = memoryMocks.updateGapStatus.mock.calls.filter(
      (call: unknown[]) => call[1] === GapStatus.ARCHIVED
    );
    expect(archivedCalls).toHaveLength(0);
  });
});

describe('BuildMonitor — Atomic Sync (Metadata Resolution)', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    vi.clearAllMocks();
  });

  it('should resolve metadata from CodeBuild environment variables when DDB records are missing', async () => {
    // 1. DDB returns nothing
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    // 2. CodeBuild returns environment variables
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          id: 'build-123',
          environment: {
            computeType: 'BUILD_GENERAL1_SMALL',
            image: 'aws/codebuild/amazonlinux2-x86_64-standard:5.0',
            type: 'LINUX_CONTAINER',
            environmentVariables: [
              { name: 'INITIATOR_USER_ID', value: 'user-env' },
              { name: 'TRACE_ID', value: 't-env' },
              { name: 'GAP_IDS', value: JSON.stringify(['GAP#env1']) },
            ],
          },
        },
      ],
    });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-123',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    // Verify gaps from env were updated
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#env1', GapStatus.DEPLOYED);

    // Verify success event used env metadata
    const { emitEvent } = await import('../lib/utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/success/i),
      expect.objectContaining({
        userId: 'user-env',
        traceId: 't-env',
        gapIds: ['GAP#env1'],
      }),
      expect.any(Object)
    );
  });

  it('should prioritize DDB metadata over environment variables', async () => {
    // 1. DDB returns valid metadata
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-ddb', traceId: 't-ddb' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#ddb1']) }] });

    // 2. CodeBuild returns different environment variables
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          id: 'build-456',
          environment: {
            computeType: 'BUILD_GENERAL1_SMALL',
            image: 'aws/codebuild/amazonlinux2-x86_64-standard:5.0',
            type: 'LINUX_CONTAINER',
            environmentVariables: [
              { name: 'INITIATOR_USER_ID', value: 'user-env' },
              { name: 'TRACE_ID', value: 't-env' },
              { name: 'GAP_IDS', value: JSON.stringify(['GAP#env1']) },
            ],
          },
        },
      ],
    });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-456',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    // Verify DDB metadata won
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#ddb1', GapStatus.DEPLOYED);
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#env1', GapStatus.DEPLOYED);

    const { emitEvent } = await import('../lib/utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/success/i),
      expect.objectContaining({
        userId: 'user-ddb',
        traceId: 't-ddb',
        gapIds: ['GAP#ddb1'],
      }),
      expect.any(Object)
    );
  });
});
