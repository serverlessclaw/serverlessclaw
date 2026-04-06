import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// 2. Mock AgentBus / EventBridge
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  PutEventsCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 3. Mock DynamoDB for idempotency
const { mockDdbSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(function () {
      return { send: mockDdbSend };
    }),
  },
  PutCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
  GetCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 4. Mock Outbound
vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

// 5. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 6. Mock Registry / Config
vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue('50'),
  },
}));

// 7. Mock ParallelAggregator
const { mockGetState, mockAddResult } = vi.hoisted(() => ({
  mockGetState: vi.fn().mockResolvedValue(null),
  mockAddResult: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/agent/parallel-aggregator', () => ({
  aggregator: {
    getState: mockGetState,
    addResult: mockAddResult,
  },
}));

// 8. Import code to test
import { handleTaskResult } from './task-result-handler';
import { EventType } from '../../lib/types/agent';

describe('task-result-handler (Direct Voice Flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(null);
    mockDdbSend.mockResolvedValue({});
  });

  it('should include USER_ALREADY_NOTIFIED marker in continuation task when userNotified is true', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'strategic-planner',
      task: 'Analyze architecture',
      response: 'The architecture is serverless...',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-456',
      userNotified: true,
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Verify EventBridge emission (wakeupInitiator)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Entries: [
            expect.objectContaining({
              DetailType: EventType.CONTINUATION_TASK,
              Detail: expect.stringContaining('(USER_ALREADY_NOTIFIED: true)'),
            }),
          ],
        }),
      })
    );
  });

  it('should NOT include USER_ALREADY_NOTIFIED marker when userNotified is false or missing', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'coder',
      task: 'Fix bug',
      response: 'Bug fixed',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-456',
      // userNotified missing
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Verify marker is ABSENT
    const callDetail = JSON.parse(mockSend.mock.calls[0][0].input.Entries[0].Detail);
    expect(callDetail.task).not.toContain('(USER_ALREADY_NOTIFIED: true)');
    expect(callDetail.task).toContain('DELEGATED_TASK_RESULT');
  });

  it('should propagate userNotified flag through task failure events', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'strategic-planner',
      task: 'Complex audit',
      error: 'Simulated failure',
      initiatorId: 'superclaw',
      depth: 1,
      userNotified: true,
    };

    await handleTaskResult(eventDetail, EventType.TASK_FAILED);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Detail: expect.stringContaining('(USER_ALREADY_NOTIFIED: true)'),
            }),
          ],
        }),
      })
    );
  });
});

describe('task-result-handler (Bug 4 — duplicate event dedup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(null);
    mockDdbSend.mockResolvedValue({});
  });

  it('should skip processing when the same event id is received twice', async () => {
    const eventDetail = {
      id: 'evt-dedup-001',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Implement feature',
      response: 'Feature implemented',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-1',
    };

    // First call — should process
    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);
    const firstCallCount = mockSend.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Second call with same id — should be skipped
    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);
    expect(mockSend.mock.calls.length).toBe(firstCallCount); // no new calls
  });

  it('should process events with different ids', async () => {
    const event1 = {
      id: 'evt-dedup-002',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task A',
      response: 'Done A',
      initiatorId: 'superclaw',
      depth: 1,
    };
    const event2 = {
      id: 'evt-dedup-003',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task B',
      response: 'Done B',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(event1, EventType.TASK_COMPLETED);
    const afterFirst = mockSend.mock.calls.length;

    await handleTaskResult(event2, EventType.TASK_COMPLETED);
    expect(mockSend.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('should deduplicate failure events with the same id', async () => {
    const eventDetail = {
      id: 'evt-dedup-004',
      userId: 'user-123',
      agentId: 'qa',
      task: 'Run tests',
      error: 'Test failure',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail, EventType.TASK_FAILED);
    const afterFirst = mockSend.mock.calls.length;

    // Duplicate failure
    await handleTaskResult(eventDetail, EventType.TASK_FAILED);
    expect(mockSend.mock.calls.length).toBe(afterFirst);
  });

  it('should still process events that have no id field', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'monitor',
      task: 'Health check',
      response: 'All good',
      initiatorId: 'superclaw',
      depth: 1,
    };

    // Both calls should process (no id to dedup on)
    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);
    const afterFirst = mockSend.mock.calls.length;

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);
    expect(mockSend.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe('task-result-handler (parallel aggregator guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(null);
    mockAddResult.mockResolvedValue(null);
    mockDdbSend.mockResolvedValue({});
  });

  it('should NOT call aggregator.addResult when no parallel state exists', async () => {
    mockGetState.mockResolvedValue(null);

    const eventDetail = {
      id: 'evt-parallel-guard-001',
      userId: 'user-123',
      agentId: 'strategic-planner',
      task: 'Plan architecture',
      response: 'Plan complete',
      traceId: 'trace-abc',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-1',
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Should have checked state but NOT added result
    expect(mockGetState).toHaveBeenCalledWith('user-123', 'trace-abc');
    expect(mockAddResult).not.toHaveBeenCalled();
  });

  it('should call aggregator.addResult only when parallel state exists', async () => {
    mockGetState.mockResolvedValue({
      taskCount: 3,
      completedCount: 0,
      results: [],
      status: 'pending',
    });
    mockAddResult.mockResolvedValue({
      isComplete: false,
      taskCount: 3,
      results: [{ taskId: 't1', agentId: 'coder', status: 'success' }],
      initiatorId: 'superclaw',
      sessionId: 'session-1',
      status: 'pending',
    });

    const eventDetail = {
      id: 'evt-parallel-guard-002',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Implement feature',
      response: 'Done',
      traceId: 'trace-xyz',
      taskId: 'task-1',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-1',
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    expect(mockGetState).toHaveBeenCalledWith('user-123', 'trace-xyz');
    expect(mockAddResult).toHaveBeenCalledWith(
      'user-123',
      'trace-xyz',
      expect.objectContaining({
        taskId: 'task-1',
        agentId: 'coder',
        status: 'success',
      })
    );
  });

  it('should skip aggregation entirely when traceId is missing', async () => {
    const eventDetail = {
      id: 'evt-no-trace-001',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Quick fix',
      response: 'Fixed',
      initiatorId: 'superclaw',
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Now that traceId has a default in the schema (t-...), it's always present.
    // We check that it's called with a generated trace ID.
    expect(mockGetState).toHaveBeenCalledWith('user-123', expect.stringMatching(/^t-\d+-/));
  });
});

describe('task-result-handler (DynamoDB idempotency for cold-start dedup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(null);
    mockDdbSend.mockResolvedValue({});
  });

  it('should write idempotency record for first-time events', async () => {
    mockDdbSend.mockResolvedValue({});

    const eventDetail = {
      id: 'evt-idempotent-001',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Build feature',
      response: 'Built',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Should have called DynamoDB PutCommand with idempotency key
    expect(mockDdbSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-memory-table',
          Item: expect.objectContaining({
            userId: 'IDEMPOTENCY#task_result:evt-idempotent-001',
            type: 'IDEMPOTENCY',
          }),
          ConditionExpression: 'attribute_not_exists(userId)',
        }),
      })
    );
  });

  it('should skip processing when DynamoDB idempotency check fails (duplicate)', async () => {
    // Simulate ConditionalCheckFailedException 14 item already exists
    const conditionalError = new Error('ConditionalCheckFailedException');
    conditionalError.name = 'ConditionalCheckFailedException';
    mockDdbSend.mockRejectedValue(conditionalError);

    const eventDetail = {
      id: 'evt-idempotent-002',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Build feature',
      response: 'Built',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Should NOT have emitted any continuation event since it was a duplicate
    // (wakeupInitiator should not have been called)
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should fail-open and process when DynamoDB is unavailable', async () => {
    // Simulate generic DynamoDB error (not ConditionalCheckFailedException)
    mockDdbSend.mockRejectedValue(new Error('Throughput exceeded'));

    const eventDetail = {
      id: 'evt-idempotent-003',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Build feature',
      response: 'Built',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Should still process (fail-open) 14 wakeupInitiator called
    expect(mockSend).toHaveBeenCalled();
  });

  it('should use both in-memory and DynamoDB dedup together', async () => {
    const eventDetail = {
      id: 'evt-idempotent-004',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task',
      response: 'Done',
      initiatorId: 'superclaw',
      depth: 1,
    };

    // First call 14 both in-memory and DynamoDB should be used
    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);
    const ddbCallsAfterFirst = mockDdbSend.mock.calls.length;
    const ebCallsAfterFirst = mockSend.mock.calls.length;

    // Second call 14 in-memory set should catch it before DynamoDB
    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // No new DynamoDB calls (in-memory caught it)
    expect(mockDdbSend.mock.calls.length).toBe(ddbCallsAfterFirst);
    // No new EventBridge calls
    expect(mockSend.mock.calls.length).toBe(ebCallsAfterFirst);
  });

  it('should prefer __envelopeId over id for deduplication', async () => {
    // First call with __envelopeId='envelope-001' and id='detail-001'
    const eventDetail1 = {
      __envelopeId: 'envelope-001',
      id: 'detail-001',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task A',
      response: 'Done A',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail1, EventType.TASK_COMPLETED);
    const afterFirst = mockSend.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Second call with same __envelopeId='envelope-001' but different id='detail-002'
    // Should be skipped because __envelopeId takes precedence
    const eventDetail2 = {
      __envelopeId: 'envelope-001',
      id: 'detail-002',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task B',
      response: 'Done B',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail2, EventType.TASK_COMPLETED);
    // No new calls 14 envelope-001 was already processed
    expect(mockSend.mock.calls.length).toBe(afterFirst);
  });

  it('should use detail id for dedup when __envelopeId is not present', async () => {
    const eventDetail1 = {
      id: 'detail-only-001',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task A',
      response: 'Done A',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail1, EventType.TASK_COMPLETED);
    const afterFirst = mockSend.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Same id 14 should be skipped
    const eventDetail2 = {
      id: 'detail-only-001',
      userId: 'user-123',
      agentId: 'coder',
      task: 'Task B',
      response: 'Done B',
      initiatorId: 'superclaw',
      depth: 1,
    };

    await handleTaskResult(eventDetail2, EventType.TASK_COMPLETED);
    expect(mockSend.mock.calls.length).toBe(afterFirst);
  });
});
