import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 2. Mock escalation manager
const { mockGetEscalationState, mockHandleLevelTimeout } = vi.hoisted(() => ({
  mockGetEscalationState: vi.fn().mockResolvedValue(null),
  mockHandleLevelTimeout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/lifecycle/escalation-manager', () => ({
  escalationManager: {
    getEscalationState: mockGetEscalationState,
    handleLevelTimeout: mockHandleLevelTimeout,
  },
}));

// 3. Import code under test
import { handleEscalationLevelTimeout } from './escalation-handler';

describe('escalation-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseEventDetail = {
    traceId: 'trace-abc',
    agentId: 'coder',
    userId: 'user-123',
    question: 'How should I proceed?',
    originalTask: 'Implement feature X',
    currentLevel: 1,
    policyId: 'policy-default',
  };

  describe('handleEscalationLevelTimeout', () => {
    it('returns early when no escalation state found', async () => {
      mockGetEscalationState.mockResolvedValue(null);

      await handleEscalationLevelTimeout(baseEventDetail);

      expect(mockHandleLevelTimeout).not.toHaveBeenCalled();
    });

    it('returns early when escalation is already completed', async () => {
      mockGetEscalationState.mockResolvedValue({
        completed: true,
        currentLevel: 2,
      });

      await handleEscalationLevelTimeout(baseEventDetail);

      expect(mockHandleLevelTimeout).not.toHaveBeenCalled();
    });

    it('handles level timeout for active escalation', async () => {
      mockGetEscalationState.mockResolvedValue({
        completed: false,
        currentLevel: 1,
      });

      await handleEscalationLevelTimeout(baseEventDetail);

      expect(mockHandleLevelTimeout).toHaveBeenCalledWith(
        'trace-abc',
        'coder',
        'How should I proceed?',
        'Implement feature X'
      );
    });

    it('uses fallback values when question and originalTask are not provided', async () => {
      mockGetEscalationState.mockResolvedValue({
        completed: false,
        currentLevel: 1,
      });

      const detail = {
        traceId: 'trace-abc',
        agentId: 'coder',
        userId: 'user-123',
        currentLevel: 1,
        policyId: 'policy-default',
      };

      await handleEscalationLevelTimeout(detail);

      expect(mockHandleLevelTimeout).toHaveBeenCalledWith(
        'trace-abc',
        'coder',
        'No question provided',
        'No task provided'
      );
    });

    it('logs error but does not throw when handleLevelTimeout fails', async () => {
      mockGetEscalationState.mockResolvedValue({
        completed: false,
        currentLevel: 1,
      });
      mockHandleLevelTimeout.mockRejectedValue(new Error('Escalation failed'));

      await expect(handleEscalationLevelTimeout(baseEventDetail)).resolves.not.toThrow();
    });
  });
});
