import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EscalationManager } from './escalation-manager';
import { EventType } from '../types/agent';
import { ClarificationStatus } from '../types/memory';

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ConfigManager
const { mockGetRawConfig, mockSaveRawConfig } = vi.hoisted(() => ({
  mockGetRawConfig: vi.fn(),
  mockSaveRawConfig: vi.fn(),
}));
vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: mockGetRawConfig,
    saveRawConfig: mockSaveRawConfig,
  },
}));

// Mock DynamoMemory
const { mockUpdateClarificationStatus, mockSaveEscalationState, mockGetEscalationState } =
  vi.hoisted(() => ({
    mockUpdateClarificationStatus: vi.fn(),
    mockSaveEscalationState: vi.fn(),
    mockGetEscalationState: vi.fn(),
  }));
vi.mock('../memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      updateClarificationStatus: mockUpdateClarificationStatus,
      saveEscalationState: mockSaveEscalationState,
      getEscalationState: mockGetEscalationState,
    };
  }),
}));

// Mock bus
const { mockEmitEvent } = vi.hoisted(() => ({
  mockEmitEvent: vi.fn(),
}));
vi.mock('../utils/bus', () => ({
  emitEvent: mockEmitEvent,
  EventPriority: {
    HIGH: 'high',
    CRITICAL: 'critical',
  },
}));

// Mock outbound
const { mockSendOutboundMessage } = vi.hoisted(() => ({
  mockSendOutboundMessage: vi.fn(),
}));
vi.mock('../outbound', () => ({
  sendOutboundMessage: mockSendOutboundMessage,
}));

// Mock DynamicScheduler (dynamic import in code)
const { mockScheduleOneShotTimeout } = vi.hoisted(() => ({
  mockScheduleOneShotTimeout: vi.fn(),
}));
vi.mock('./scheduler', () => ({
  DynamicScheduler: {
    scheduleOneShotTimeout: mockScheduleOneShotTimeout,
  },
}));

describe('EscalationManager', () => {
  let manager: EscalationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new EscalationManager();
  });

  describe('startEscalation', () => {
    it('should start escalation and sync status with memory', async () => {
      // Mock policy
      mockGetRawConfig.mockResolvedValue(null); // Fallback to default policy

      const state = await manager.startEscalation(
        'trace-1',
        'agent-1',
        'user-1',
        'What is your name?',
        'Identify yourself',
        'session-1'
      );

      expect(state.currentLevel).toBe(1);
      expect(mockSaveEscalationState).toHaveBeenCalled();
      expect(mockUpdateClarificationStatus).toHaveBeenCalledWith(
        'trace-1',
        'agent-1',
        ClarificationStatus.ESCALATED
      );
      expect(mockSendOutboundMessage).toHaveBeenCalled();
      expect(mockScheduleOneShotTimeout).toHaveBeenCalledWith(
        expect.stringContaining('escalation-trace-1-agent-1-1'),
        expect.any(Object),
        expect.any(Number),
        EventType.ESCALATION_LEVEL_TIMEOUT
      );
    });
  });

  describe('handleLevelTimeout', () => {
    it('should escalate to next level if available', async () => {
      const mockState = {
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 1,
        policyId: 'default',
        completed: false,
      };
      mockGetEscalationState.mockResolvedValue(mockState);

      // Default policy has 3 levels
      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockSaveEscalationState).toHaveBeenCalledWith(
        expect.objectContaining({ currentLevel: 2 })
      );
      expect(mockScheduleOneShotTimeout).toHaveBeenCalledWith(
        expect.stringContaining('escalation-trace-1-agent-1-2'),
        expect.any(Object),
        expect.any(Number),
        EventType.ESCALATION_LEVEL_TIMEOUT
      );
    });

    it('should execute final action if all levels exhausted', async () => {
      const mockState = {
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 3,
        policyId: 'default', // Final action is 'fail'
        completed: false,
      };
      mockGetEscalationState.mockResolvedValue(mockState);

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.ESCALATION_COMPLETED,
        expect.objectContaining({ outcome: 'failed' }),
        expect.any(Object)
      );
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.TASK_FAILED,
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});
