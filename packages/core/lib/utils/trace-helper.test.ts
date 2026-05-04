import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addTraceStep, updateTraceMetadata, updateTraceStatus } from './trace-helper';
import { resetDocClient } from './ddb-client';
import { TraceType } from '../types/constants';

// Mock dependencies
vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockSend = vi.fn().mockResolvedValue({});

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
  UpdateCommand: class {
    constructor(public input: any) {}
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

describe('Trace Helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
    resetDocClient();
  });

  describe('TraceType Values', () => {
    it('should have all new agent communication trace types', () => {
      expect(TraceType.CLARIFICATION_REQUEST).toBe('clarification_request');
      expect(TraceType.CLARIFICATION_RESPONSE).toBe('clarification_response');
      expect(TraceType.PARALLEL_DISPATCH).toBe('parallel_dispatch');
      expect(TraceType.PARALLEL_BARRIER).toBe('parallel_barrier');
      expect(TraceType.PARALLEL_COMPLETED).toBe('parallel_completed');
      expect(TraceType.COUNCIL_REVIEW).toBe('council_review');
      expect(TraceType.CONTINUATION).toBe('continuation');
    });

    it('should have all system event trace types', () => {
      expect(TraceType.CIRCUIT_BREAKER).toBe('circuit_breaker');
      expect(TraceType.CANCELLATION).toBe('cancellation');
      expect(TraceType.MEMORY_OPERATION).toBe('memory_operation');
    });

    it('should have agent state trace types', () => {
      expect(TraceType.AGENT_WAITING).toBe('agent_waiting');
      expect(TraceType.AGENT_RESUMED).toBe('agent_resumed');
    });

    it('should have standard trace types', () => {
      expect(TraceType.LLM_CALL).toBe('llm_call');
      expect(TraceType.LLM_RESPONSE).toBe('llm_response');
      expect(TraceType.TOOL_CALL).toBe('tool_call');
      expect(TraceType.TOOL_RESPONSE).toBe('tool_result');
      expect(TraceType.ERROR).toBe('error');
    });
  });

  describe('addTraceStep', () => {
    it('should skip if no traceId provided', async () => {
      const { logger } = await import('../logger');

      await addTraceStep(undefined, undefined, {
        type: TraceType.LLM_CALL,
        content: { test: 'data' },
      });

      expect(logger.info).toHaveBeenCalledWith('No traceId provided, skipping trace step');
    });

    it('should add trace step with correct structure', async () => {
      await addTraceStep('trace-123', 'node-456', {
        type: TraceType.CLARIFICATION_REQUEST,
        content: { question: 'What does this mean?' },
        metadata: { agentId: 'coder' },
      });

      expect(mockSend).toHaveBeenCalled();
    });

    it('should default nodeId to root if not provided', async () => {
      await addTraceStep('trace-123', undefined, {
        type: TraceType.AGENT_WAITING,
        content: { reason: 'Waiting for clarification' },
      });

      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('updateTraceMetadata', () => {
    it('should skip if no traceId provided', async () => {
      await updateTraceMetadata(undefined, undefined, { key: 'value' });
      // Should not throw
    });

    it('should update metadata for existing trace', async () => {
      await updateTraceMetadata('trace-123', 'node-456', { parallelCount: 3 });

      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('updateTraceStatus', () => {
    it('should skip if no traceId provided', async () => {
      await updateTraceStatus(undefined, undefined, 'completed');
      // Should not throw
    });

    it('should update status for existing trace', async () => {
      await updateTraceStatus('trace-123', 'node-456', 'paused');

      expect(mockSend).toHaveBeenCalled();
    });
  });
});
