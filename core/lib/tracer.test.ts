import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClawTracer, resetDocClient } from './tracer';
import { TraceType } from './types/constants';
import { AgentRegistry } from './registry';
import { TraceSource } from './types/agent';

// Mock AgentRegistry
vi.mock('./registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn(),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock AWS SDK
const mockSend = vi.fn();
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
  },
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

describe('ClawTracer', () => {
  let tracer: ClawTracer;

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentRegistry.getRetentionDays as any).mockResolvedValue(30);
    resetDocClient();
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

      expect(mockSend).toHaveBeenCalledTimes(2);
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
      ];

      expect(allTypes).toEqual(expect.arrayContaining(expectedTypes));
      expect(allTypes.length).toBe(expectedTypes.length);
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
});
