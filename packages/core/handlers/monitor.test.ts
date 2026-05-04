import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { GapStatus } from '../lib/types/agent';

const ddbMock = mockClient(DynamoDBDocumentClient);
const cbMock = mockClient(CodeBuildClient);
const cwMock = mockClient(CloudWatchLogsClient);
const s3Mock = mockClient(S3Client);

const memoryMocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue({ success: true }),
  incrementGapAttemptCount: vi.fn(),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  releaseGapLock: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    updateGapStatus = (...args: any[]) => memoryMocks.updateGapStatus(...args);
    incrementGapAttemptCount = (...args: any[]) => memoryMocks.incrementGapAttemptCount(...args);
    acquireGapLock = (...args: any[]) => memoryMocks.acquireGapLock(...args);
    releaseGapLock = (...args: any[]) => memoryMocks.releaseGapLock(...args);
    updateDistilledMemory = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: class {
    static getRawConfig = vi.fn().mockResolvedValue(0);
    static saveRawConfig = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../lib/lifecycle/health', () => ({
  reportHealthIssue: vi.fn().mockResolvedValue(undefined),
}));

const circuitBreakerMocks = vi.hoisted(() => ({
  recordSuccess: vi.fn().mockResolvedValue({}),
  recordFailure: vi.fn().mockResolvedValue({ state: 'closed', failures: [] }),
}));

vi.mock('../lib/safety/circuit-breaker', () => ({
  getCircuitBreaker: vi.fn().mockReturnValue({
    recordSuccess: circuitBreakerMocks.recordSuccess,
    recordFailure: circuitBreakerMocks.recordFailure,
  }),
}));

vi.mock('../lib/utils/topology', () => ({
  discoverSystemTopology: vi.fn().mockResolvedValue({ nodes: [] }),
}));

const busMocks = vi.hoisted(() => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/bus', () => ({
  emitEvent: busMocks.emitEvent,
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
    s3Mock.reset();
    vi.clearAllMocks();

    ddbMock.on(QueryCommand).resolves({
      Items: [SUCCESS_META],
    });
    ddbMock.on(GetCommand).resolves({
      Item: { value: { state: 'closed', failures: [], version: 1 } },
    });
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [{ logs: { groupName: '/aws/test', streamName: 'stream-1' } }],
    });
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'Error: build failed' }] });
  });

  it('should REOPEN a gap when attempt count is below the cap', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1);
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ ...SUCCESS_META, initiatorUserId: 'user-1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1001']) }] });

    const { handler } = await import('./monitor');
    await handler(makeFailEvent('build-1') as unknown as Parameters<typeof handler>[0]);

    expect(memoryMocks.acquireGapLock).toHaveBeenCalled();
    expect(memoryMocks.incrementGapAttemptCount).toHaveBeenCalledWith('GAP#1001');
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.OPEN);
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1001', GapStatus.FAILED);
  });

  it('should FAIL a gap when attempt count reaches the cap (3)', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(3);
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
    s3Mock.reset();
    vi.clearAllMocks();

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [{ logs: { groupName: '/aws/test', streamName: 'stream-1' } }],
    });
  });

  it('should resolve metadata from CodeBuild environment variables when DDB records are missing', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

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

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#env1', GapStatus.DEPLOYED);

    const { emitEvent } = await import('../lib/utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/success/i),
      expect.objectContaining({
        userId: 'user-env',
        traceId: 't-env',
        metadata: { gapIds: ['GAP#env1'] },
      }),
      expect.any(Object)
    );
  });

  it('should prioritize DDB metadata over environment variables', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-ddb', traceId: 't-ddb' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#ddb1']) }] });

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

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#ddb1', GapStatus.DEPLOYED);
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#env1', GapStatus.DEPLOYED);

    const { emitEvent } = await import('../lib/utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/success/i),
      expect.objectContaining({
        userId: 'user-ddb',
        traceId: 't-ddb',
        metadata: { gapIds: ['GAP#ddb1'] },
      }),
      expect.any(Object)
    );
  });

  describe('Transition Failure Logging', () => {
    beforeEach(() => {
      ddbMock.reset();
      cbMock.reset();
      vi.clearAllMocks();

      ddbMock.on(QueryCommand).resolves({
        Items: [SUCCESS_META],
      });
      cbMock.on(BatchGetBuildsCommand).resolves({
        builds: [{ logs: { groupName: '/aws/test', streamName: 'stream-1' } }],
      });
    });

    it('should log a warning if gap transition fails during build success', async () => {
      const { logger } = await import('../lib/logger');
      const spy = vi.spyOn(logger, 'warn');

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
        .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#fail1']) }] });

      memoryMocks.updateGapStatus.mockResolvedValue({
        success: false,
        error: 'Expected PROGRESS state',
      });

      const { handler } = await import('./monitor');
      const event = {
        detail: {
          'build-id': 'build-fail-1',
          'project-name': 'test-project',
          'build-status': 'SUCCEEDED',
        },
      };

      await handler(event as any);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to transition gap GAP#fail1 to DEPLOYED: Expected PROGRESS state'
        )
      );
    });

    it('should log a warning if gap transition fails during build failure', async () => {
      const { logger } = await import('../lib/logger');
      const spy = vi.spyOn(logger, 'warn');

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
        .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#fail2']) }] });

      memoryMocks.incrementGapAttemptCount.mockResolvedValue(1);
      memoryMocks.updateGapStatus.mockResolvedValue({
        success: false,
        error: 'Item not found',
      });

      const { handler } = await import('./monitor');
      const event = {
        detail: {
          'build-id': 'build-fail-2',
          'project-name': 'test-project',
          'build-status': 'FAILED',
        },
      };

      await handler(event as any);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to transition gap GAP#fail2 to OPEN: Item not found')
      );
    });
  });
});

describe('BuildMonitor — Build ID ARN normalization', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should normalize buildId when it is an ARN', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [{ logs: { groupName: '/aws/test', streamName: 'stream-1' } }],
    });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'arn:aws:codebuild:us-east-1:123456789:build/my-project:abc-123-def',
        'project-name': 'my-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1', GapStatus.DEPLOYED);
  });
});

describe('BuildMonitor — Missing userId early return', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should return early and log warning when no userId is found', async () => {
    const { logger } = await import('../lib/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [{ environment: { environmentVariables: [] } }],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-no-user',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    expect(warnSpy).toHaveBeenCalledWith(
      'No initiator found for build build-no-user in DynamoDB or environment variables.'
    );
    expect(busMocks.emitEvent).not.toHaveBeenCalled();
  });
});

describe('BuildMonitor — Invalid GAP_IDS env var parsing', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should log warning and skip gaps when GAP_IDS env var is invalid JSON', async () => {
    const { logger } = await import('../lib/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          environment: {
            environmentVariables: [
              { name: 'INITIATOR_USER_ID', value: 'user-1' },
              { name: 'GAP_IDS', value: 'not-valid-json' },
            ],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-bad-gaps',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to parse GAP_IDS from environment variables:',
      expect.any(Error)
    );
  });
});

describe('BuildMonitor — Circuit breaker error handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should log error when circuit breaker recordSuccess fails', async () => {
    const { logger } = await import('../lib/logger');
    const errorSpy = vi.spyOn(logger, 'error');

    circuitBreakerMocks.recordSuccess.mockRejectedValueOnce(new Error('CB connection lost'));

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-cb-err',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to record build success in circuit breaker:',
      expect.any(Error)
    );
  });

  it('should report health issue when circuit breaker recordFailure throws', async () => {
    const { reportHealthIssue } = await import('../lib/lifecycle/health');

    circuitBreakerMocks.recordFailure.mockRejectedValueOnce(new Error('CB write failed'));

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 'trace-123' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'error log' }] });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-cb-fail',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(reportHealthIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'BuildMonitor',
        issue: 'Failed to record build failure in circuit breaker',
        severity: 'medium',
        userId: 'user-1',
        traceId: 'trace-123',
        context: expect.objectContaining({
          buildId: 'build-cb-fail',
        }),
      })
    );
  });

  it('should log warning when circuit breaker opens after failures', async () => {
    const { logger } = await import('../lib/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    circuitBreakerMocks.recordFailure.mockResolvedValueOnce({
      state: 'open',
      failures: ['f1', 'f2', 'f3'],
    });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'error' }] });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-cb-open',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(warnSpy).toHaveBeenCalledWith(
      'Circuit Breaker: Opened after 3 failures in sliding window.'
    );
  });
});

describe('BuildMonitor — Lock contention handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should skip gap transition when lock cannot be acquired on success', async () => {
    memoryMocks.acquireGapLock.mockResolvedValueOnce(false);

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#lock1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#lock1']) }],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-lock-fail',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    expect(memoryMocks.acquireGapLock).toHaveBeenCalledWith('GAP#lock1', 'monitor');
    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalled();
  });

  it('should skip gap transition when lock cannot be acquired on failure', async () => {
    memoryMocks.acquireGapLock.mockResolvedValueOnce(false);

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#lock2']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#lock2']) }],
          },
        },
      ],
    } as any);
    cwMock.on(GetLogEventsCommand).resolves({ events: [] });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-lock-fail-2',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(memoryMocks.acquireGapLock).toHaveBeenCalledWith('GAP#lock2', 'monitor');
    expect(memoryMocks.incrementGapAttemptCount).not.toHaveBeenCalled();
  });
});

describe('BuildMonitor — S3 failure manifest fetching', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    cwMock.reset();
    vi.clearAllMocks();

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          artifacts: { location: 's3://my-bucket/prefix/artifacts' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'build error' }] });
  });

  it('should fetch and parse failure manifest from S3 when artifact location is valid', async () => {
    const manifestContent = JSON.stringify({
      errors: [{ code: 'DEPLOY_FAILED', message: 'Stack update failed' }],
    });
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToString: () => Promise.resolve(manifestContent) },
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-s3-success',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(busMocks.emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/failed/i),
      expect.objectContaining({
        failureManifest: {
          errors: [{ code: 'DEPLOY_FAILED', message: 'Stack update failed' }],
        },
      }),
      expect.any(Object)
    );
  });

  it('should log warning and continue when S3 manifest fetch fails', async () => {
    const { logger } = await import('../lib/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-s3-fail',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(warnSpy).toHaveBeenCalledWith(
      'Could not retrieve failure manifest from S3 (might not exist or is zipped):',
      expect.any(Error)
    );

    expect(busMocks.emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/failed/i),
      expect.objectContaining({
        failureManifest: null,
      }),
      expect.any(Object)
    );
  });

  it('should not attempt S3 fetch when artifact location is not S3', async () => {
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          artifacts: { location: 'https://example.com/artifacts' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-no-s3',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    const s3Calls = s3Mock.commandCalls(GetObjectCommand);
    expect(s3Calls).toHaveLength(0);
  });

  it('should not attempt S3 fetch when artifact location is missing', async () => {
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-no-artifact',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    const s3Calls = s3Mock.commandCalls(GetObjectCommand);
    expect(s3Calls).toHaveLength(0);
  });
});

describe('BuildMonitor — Empty logs handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    cwMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-empty' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);
  });

  it('should produce empty string when log events array is empty', async () => {
    cwMock.on(GetLogEventsCommand).resolves({ events: [] });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-empty-logs',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(busMocks.emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/failed/i),
      expect.objectContaining({
        errorLogs: '',
      }),
      expect.any(Object)
    );
  });

  it('should use default message when build has no logs', async () => {
    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-no-logs',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(busMocks.emitEvent).toHaveBeenCalledWith(
      'build.monitor',
      expect.stringMatching(/failed/i),
      expect.objectContaining({
        errorLogs: 'Could not retrieve logs.',
      }),
      expect.any(Object)
    );
  });
});

describe('BuildMonitor — Outer error handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should catch, log, and re-throw errors when CodeBuild client throws', async () => {
    const { logger } = await import('../lib/logger');
    const errorSpy = vi.spyOn(logger, 'error');

    cbMock.on(BatchGetBuildsCommand).rejects(new Error('CodeBuild service unavailable'));

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-err',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await expect(handler(event as any)).rejects.toThrow('CodeBuild service unavailable');
    expect(errorSpy).toHaveBeenCalledWith('Error in BuildMonitor:', expect.any(Error));
  });

  it('should catch, log, and re-throw errors when DynamoDB query throws', async () => {
    const { logger } = await import('../lib/logger');
    const errorSpy = vi.spyOn(logger, 'error');

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          environment: {
            environmentVariables: [],
            type: 'LINUX_CONTAINER',
            image: 'aws/codebuild/standard:7.0',
            computeType: 'BUILD_GENERAL1_SMALL',
          },
        },
      ],
    });
    ddbMock.on(QueryCommand).rejects(new Error('DynamoDB connection timeout'));

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-ddb-err',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await expect(handler(event as any)).rejects.toThrow('DynamoDB connection timeout');
    expect(errorSpy).toHaveBeenCalledWith('Error in BuildMonitor:', expect.any(Error));
  });
});

describe('BuildMonitor — Topology update error handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should log error when topology save fails', async () => {
    const { logger } = await import('../lib/logger');
    const errorSpy = vi.spyOn(logger, 'error');

    const { ConfigManager } = await import('../lib/registry/config');
    (ConfigManager.saveRawConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ConfigTable write failed')
    );

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-topo-err',
        'project-name': 'test-project',
        'build-status': 'SUCCEEDED',
      },
    };

    await handler(event as any);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to update system topology in ConfigTable:',
      expect.any(Error)
    );
  });
});

describe('BuildMonitor — Transition rejection metrics on failure', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#rej1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#rej1']) }],
          },
        },
      ],
    } as any);
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'error' }] });
  });

  it('should record transition rejection metric when transitioning to FAILED fails', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(3);
    memoryMocks.updateGapStatus.mockResolvedValue({
      success: false,
      error: 'ConditionalCheckFailed',
    });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-rej-failed',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#rej1', GapStatus.FAILED);
  });

  it('should record transition rejection metric when transitioning to OPEN fails', async () => {
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1);
    memoryMocks.updateGapStatus.mockResolvedValue({
      success: false,
      error: 'Item not found',
    });

    const { handler } = await import('./monitor');
    const event = {
      detail: {
        'build-id': 'build-rej-open',
        'project-name': 'test-project',
        'build-status': 'FAILED',
      },
    };

    await handler(event as any);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#rej1', GapStatus.OPEN);
  });
});

describe('BuildMonitor — Other failure statuses', () => {
  beforeEach(() => {
    ddbMock.reset();
    cbMock.reset();
    cwMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ initiatorUserId: 'user-1', traceId: 't1' }] })
      .resolvesOnce({ Items: [{ content: JSON.stringify(['GAP#1']) }] });

    cbMock.on(BatchGetBuildsCommand).resolves({
      builds: [
        {
          logs: { groupName: '/aws/test', streamName: 'stream-1' },
          environment: {
            environmentVariables: [{ name: 'GAP_IDS', value: JSON.stringify(['GAP#1']) }],
          },
        },
      ],
    } as any);
    cwMock.on(GetLogEventsCommand).resolves({ events: [{ message: 'error' }] });
  });

  const failureStatuses = ['STOPPED', 'TIMED_OUT', 'FAULT'];

  failureStatuses.forEach((status) => {
    it(`should handle ${status} status same as FAILED`, async () => {
      const { handler } = await import('./monitor');
      const event = {
        detail: {
          'build-id': `build-${status.toLowerCase()}`,
          'project-name': 'test-project',
          'build-status': status,
        },
      };

      await handler(event as any);

      expect(busMocks.emitEvent).toHaveBeenCalledWith(
        'build.monitor',
        expect.stringMatching(/failed/i),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});
