import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentType } from '../../lib/types/agent';

/**
 * Council of Agents Continuation Logic Tests
 */

// ============================================================================
// Mock Setup
// ============================================================================

const memoryMocks = vi.hoisted(() => ({
  getDistilledMemory: vi.fn(),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  getFailurePatterns: vi.fn().mockResolvedValue([]),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  getGapLock: vi.fn().mockResolvedValue(null),
}));

const emitTypedEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const sendOutboundMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const emitTaskEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const dispatchTaskMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
    Deployer: { name: 'test-deployer' },
  },
}));

vi.mock('../../lib/memory', () => ({
  DynamoMemory: class {
    getDistilledMemory = memoryMocks.getDistilledMemory;
    updateDistilledMemory = memoryMocks.updateDistilledMemory;
    getFailurePatterns = memoryMocks.getFailurePatterns;
    acquireGapLock = memoryMocks.acquireGapLock;
    getGapLock = memoryMocks.getGapLock;
  },
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: sendOutboundMessageMock,
}));

vi.mock('../../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event: any) => event.detail || event),
  loadAgentConfig: vi.fn().mockResolvedValue({
    id: 'strategic-planner',
    name: 'Strategic Planner',
    systemPrompt: 'Test prompt',
    enabled: true,
  }),
  extractBaseUserId: vi.fn((userId: string) => userId),
  getAgentContext: vi.fn().mockResolvedValue({
    memory: memoryMocks,
    provider: { call: vi.fn() },
  }),
  emitTaskEvent: emitTaskEventMock,
  parseStructuredResponse: (r: string) => JSON.parse(r),
  isTaskPaused: vi.fn().mockReturnValue(false),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: emitTypedEventMock,
}));

vi.mock('../../tools/knowledge/agent', () => ({
  dispatchTask: { execute: dispatchTaskMock },
}));

vi.mock('../../tools/registry-utils', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/agent', () => ({
  Agent: class {
    stream = vi.fn();
  },
}));

const getEvolutionModeMock = vi.hoisted(() => vi.fn().mockResolvedValue('auto'));

vi.mock('../strategic-planner/evolution', () => ({
  getEvolutionMode: getEvolutionModeMock,
  recordCooldown: vi.fn().mockResolvedValue(undefined),
  isGapInCooldown: vi.fn().mockResolvedValue(false),
}));

// ============================================================================
// Tests
// ============================================================================

describe('Council of Agents — Continuation Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch to Coder when Council APPROVED and mode is AUTO', async () => {
    const { handler } = await import('../strategic-planner');

    const traceId = 'council-trace-123';
    const plan = 'Original Strategic Plan';
    const gapIds = ['GAP#1'];

    // Mock memory retrieval of the saved plan
    memoryMocks.getDistilledMemory.mockResolvedValue(
      JSON.stringify({ plan, gapIds, userId: 'user-1', sessionId: 'session-1', planId: 'PLAN-1' })
    );

    getEvolutionModeMock.mockResolvedValue('auto');

    const event = {
      detail: {
        userId: 'user-1',
        task: '[COUNCIL_REVIEW_RESULT] VERDICT: APPROVED. No critical issues found.',
        traceId,
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    // Verify outbound message
    expect(sendOutboundMessageMock).toHaveBeenCalledWith(
      AgentType.STRATEGIC_PLANNER,
      'user-1',
      expect.stringContaining('Council Approval Received'),
      ['user-1'],
      'session-1',
      'Strategic Planner'
    );

    // Verify dispatch to Coder
    expect(dispatchTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AgentType.CODER,
        task: plan,
        metadata: { gapIds },
      })
    );
  });

  it('should ask for user approval when Council APPROVED but mode is HITL', async () => {
    const { handler } = await import('../strategic-planner');

    const traceId = 'council-trace-123';
    const plan = 'Original Strategic Plan';

    memoryMocks.getDistilledMemory.mockResolvedValue(
      JSON.stringify({
        plan,
        gapIds: ['GAP#1'],
        userId: 'user-1',
        sessionId: 'session-1',
        planId: 'PLAN-1',
      })
    );

    getEvolutionModeMock.mockResolvedValue('hitl');

    const event = {
      detail: {
        userId: 'user-1',
        task: '[COUNCIL_REVIEW_RESULT] VERDICT: APPROVED. Safe to proceed.',
        traceId,
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    // Verify outbound message with buttons
    expect(sendOutboundMessageMock).toHaveBeenCalledWith(
      AgentType.STRATEGIC_PLANNER,
      'user-1',
      expect.stringContaining('Council Approval Received'),
      ['user-1'],
      'session-1',
      'Strategic Planner',
      undefined,
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ label: 'Approve' }),
        expect.objectContaining({ label: 'Clarify' }),
      ])
    );

    // Verify NO dispatch to Coder
    expect(dispatchTaskMock).not.toHaveBeenCalled();
  });

  it('should block execution and notify user when Council REJECTED', async () => {
    const { handler } = await import('../strategic-planner');

    const traceId = 'council-trace-123';
    const plan = 'Original Strategic Plan';

    memoryMocks.getDistilledMemory.mockResolvedValue(
      JSON.stringify({
        plan,
        gapIds: ['GAP#1'],
        userId: 'user-1',
        sessionId: 'session-1',
        planId: 'PLAN-1',
      })
    );

    const event = {
      detail: {
        userId: 'user-1',
        task: '[COUNCIL_REVIEW_RESULT] VERDICT: REJECTED. Security vulnerability detected.',
        traceId,
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    // Verify outbound rejection message
    expect(sendOutboundMessageMock).toHaveBeenCalledWith(
      AgentType.STRATEGIC_PLANNER,
      'user-1',
      expect.stringContaining('Council Review REJECTED'),
      ['user-1'],
      'session-1',
      'Strategic Planner'
    );

    // Verify NO dispatch to Coder
    expect(dispatchTaskMock).not.toHaveBeenCalled();
  });

  it('should handle missing plan data gracefully', async () => {
    const { handler } = await import('../strategic-planner');

    memoryMocks.getDistilledMemory.mockResolvedValue(null);

    const event = {
      detail: {
        userId: 'user-1',
        task: '[COUNCIL_REVIEW_RESULT] VERDICT: APPROVED',
        traceId: 'unknown-trace',
      },
    };

    const result = await handler(event as any, {} as any);

    expect(result).toBeDefined();
    expect(result.status).not.toBe('COUNCIL_APPROVED');
    expect(result.status).not.toBe('COUNCIL_REJECTED');
    expect(sendOutboundMessageMock).not.toHaveBeenCalled();
    expect(dispatchTaskMock).not.toHaveBeenCalled();
  });
});
