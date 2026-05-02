import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClawTracer } from './tracer';
import { TraceType } from './types/constants';
import { AgentRegistry } from './registry';
import { TraceSource } from './types/agent';

vi.mock('./registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn(),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./routing/flow-controller', () => ({
  FlowController: {
    areTraceSummariesEnabled: vi.fn().mockResolvedValue(true),
  },
}));

// Mock AWS SDK
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    send = mockSend;
  },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: mockSend,
    })),
  },
  PutCommand: class {
    constructor(public input: any) {}
  },
  UpdateCommand: class {
    constructor(public input: any) {}
  },
  QueryCommand: class {
    constructor(public input: any) {}
  },
}));

// Mock other dependencies
vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
    ConfigTable: { name: 'test-config-table' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

vi.mock('./utils/ddb-client', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getDocClient: vi.fn(() => ({
      send: mockSend,
    })),
    resetDocClient: vi.fn(),
  };
});

describe('ClawTracer', () => {
  let tracer: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (AgentRegistry.getRetentionDays as any).mockResolvedValue(30);
    const { FlowController } = await import('./routing/flow-controller');
    (FlowController.areTraceSummariesEnabled as any).mockResolvedValue(true);
    tracer = new ClawTracer('user-123', TraceSource.SYSTEM, 'test-trace-123', 'root');
  });

  describe('Initialization', () => {
    it('should initialize with provided IDs', () => {
      expect(tracer.getTraceId()).toBe('test-trace-123');
      expect(tracer.getNodeId()).toBe('root');
    });

    it('should generate a traceId if not provided', () => {
      const anonymousTracer = new ClawTracer('user-123');
      expect(anonymousTracer.getTraceId()).toBe('test-uuid-1234');
    });
  });

  describe('Agent Communication Trace Types', () => {
    it('should handle clarification request and response', async () => {
      mockSend.mockResolvedValue({});

      await tracer.addStep({
        type: TraceType.CLARIFICATION_REQUEST,
        content: { question: 'test?' },
      });

      expect(mockSend).toHaveBeenCalled();
    });

    it('should handle parallel dispatch trace types', async () => {
      mockSend.mockResolvedValue({});

      await tracer.addStep({
        type: TraceType.PARALLEL_DISPATCH,
        content: { tasks: [] },
      });

      await tracer.addStep({
        type: TraceType.PARALLEL_COMPLETED,
        content: { results: [] },
      });

      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('should handle all trace types in TraceType enum', () => {
      const allTypes = Object.values(TraceType);
      const expectedTypes = [
        'llm_call',
        'llm_response',
        'tool_call',
        'tool_result',
        'reflect',
        'emit',
        'bridge',
        'error',
        'clarification_request',
        'clarification_response',
        'parallel_dispatch',
        'parallel_barrier',
        'parallel_completed',
        'council_review',
        'continuation',
        'circuit_breaker',
        'cancellation',
        'memory_operation',
        'agent_waiting',
        'agent_resumed',
        'plan_generated',
        'code_written',
        'review_complete',
        'audit_complete',
        'aggregation_complete',
        'collaboration_started',
        'collaboration_completed',
        'collaboration_message',
      ];

      expect(allTypes).toEqual(expect.arrayContaining(expectedTypes));
    });
  });

  describe('Hierarchy', () => {
    it('should spawn child tracers with correct linking', () => {
      const child = tracer.getChildTracer('child-node', 'coder');
      expect(child.getTraceId()).toBe(tracer.getTraceId());
      expect(child.getParentId()).toBe(tracer.getNodeId());
      expect(child.getNodeId()).toBe('child-node');
    });
  });

  describe('Summary Updates', () => {
    it('should use ConditionExpression when creating a new summary', async () => {
      mockSend.mockResolvedValue({});
      await tracer.updateSummary('STARTED', { isNew: true });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(traceId)');
    });

    it('should use ConditionExpression when updating an existing summary', async () => {
      mockSend.mockResolvedValue({});
      await tracer.updateSummary('COMPLETED', { isNew: false });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(traceId)');
    });
  });
});
