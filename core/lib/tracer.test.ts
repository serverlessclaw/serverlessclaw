import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClawTracer } from './tracer';
import { AgentRegistry } from './registry';

// Mock AgentRegistry
vi.mock('./registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn(),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock AWS SDK
const mockSend = vi.fn();

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: (cmd: unknown) => mockSend(cmd),
    }),
  },
  PutCommand: class {
    constructor(public input: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).name = 'PutCommand';
    }
  },
  UpdateCommand: class {
    constructor(public input: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).name = 'UpdateCommand';
    }
  },
  QueryCommand: class {
    constructor(public input: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).name = 'QueryCommand';
    }
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    send = vi.fn();
  },
}));

// Mock Resource
vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
  },
}));

describe('ClawTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default nodeId as root', () => {
    const tracer = new ClawTracer('user-123', 'dashboard');
    expect(tracer.getTraceId()).toBeDefined();
    expect(tracer.getNodeId()).toBe('root');
    expect(tracer.getParentId()).toBeUndefined();
  });

  it('should initialize with custom IDs', () => {
    const tracer = new ClawTracer('user-123', 'dashboard', 'trace-1', 'node-1', 'parent-1');
    expect(tracer.getTraceId()).toBe('trace-1');
    expect(tracer.getNodeId()).toBe('node-1');
    expect(tracer.getParentId()).toBe('parent-1');
  });

  it('should start a trace node in DynamoDB with configurable TTL', async () => {
    vi.mocked(AgentRegistry.getRetentionDays).mockResolvedValue(7);
    const tracer = new ClawTracer('user-123', 'dashboard', 'trace-1', 'node-1');

    const now = Date.now();
    vi.setSystemTime(now);

    await tracer.startTrace({ foo: 'bar' });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PutCommand',
        input: expect.objectContaining({
          TableName: 'test-trace-table',
          Item: expect.objectContaining({
            traceId: 'trace-1',
            nodeId: 'node-1',
            userId: 'user-123',
            expiresAt: Math.floor(now / 1000) + 7 * 24 * 60 * 60,
            initialContext: { foo: 'bar' },
          }),
        }),
      })
    );

    vi.useRealTimers();
  });

  it('should add a step to the correct node', async () => {
    const tracer = new ClawTracer('user-123', 'dashboard', 'trace-1', 'node-1');
    await tracer.addStep({ type: 'llm_call', content: 'test' });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'UpdateCommand',
        input: expect.objectContaining({
          Key: { traceId: 'trace-1', nodeId: 'node-1' },
          UpdateExpression: expect.stringContaining('list_append'),
        }),
      })
    );
  });

  it('should spawn a linked child tracer', () => {
    const parentTracer = new ClawTracer('user-123', 'dashboard', 'trace-1', 'node-1');
    const childTracer = parentTracer.getChildTracer('node-2');

    expect(childTracer.getTraceId()).toBe('trace-1');
    expect(childTracer.getNodeId()).toBe('node-2');
    expect(childTracer.getParentId()).toBe('node-1');
  });

  it('should retrieve all nodes for a traceId', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { traceId: 'trace-1', nodeId: 'root' },
        { traceId: 'trace-1', nodeId: 'child-1', parentId: 'root' },
      ],
    });

    const nodes = await ClawTracer.getTrace('trace-1');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'QueryCommand',
        input: expect.objectContaining({
          TableName: 'test-trace-table',
          KeyConditionExpression: 'traceId = :tid',
          ExpressionAttributeValues: { ':tid': 'trace-1' },
        }),
      })
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[1].parentId).toBe('root');
  });
});
