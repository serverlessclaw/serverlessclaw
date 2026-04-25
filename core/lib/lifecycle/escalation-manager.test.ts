import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EscalationManager } from './escalation-manager';
import { EventType } from '../types/agent';
import { ClarificationStatus } from '../types/memory';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

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

const { mockEmitEvent } = vi.hoisted(() => ({
  mockEmitEvent: vi.fn(),
}));
vi.mock('../utils/bus', () => ({
  emitEvent: mockEmitEvent,
  EventPriority: {
    HIGH: 'high',
    CRITICAL: 'critical',
    NORMAL: 'normal',
  },
}));

const { mockSendOutboundMessage } = vi.hoisted(() => ({
  mockSendOutboundMessage: vi.fn(),
}));
vi.mock('../outbound', () => ({
  sendOutboundMessage: mockSendOutboundMessage,
}));

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

  describe('getPolicy', () => {
    it('should return user-specific policy if it exists', async () => {
      const userPolicy = { id: 'user-policy', priority: 'high', enabled: true, levels: [] };
      mockGetRawConfig.mockResolvedValue(userPolicy);

      const result = await manager.getPolicy('user-1', 'high');

      expect(result).toEqual(userPolicy);
      expect(mockGetRawConfig).toHaveBeenCalledWith('ESCALATION_POLICY#user-1_high');
    });

    it('should return global policy if user policy not found', async () => {
      const globalPolicy = { id: 'global-policy', priority: 'medium', enabled: true, levels: [] };
      mockGetRawConfig.mockResolvedValueOnce(null).mockResolvedValueOnce(globalPolicy);

      const result = await manager.getPolicy('user-1', 'medium');

      expect(result).toEqual(globalPolicy);
      expect(mockGetRawConfig).toHaveBeenCalledWith('ESCALATION_POLICY#global_medium');
    });

    it('should return default policy if no custom policy found', async () => {
      mockGetRawConfig.mockResolvedValue(null);

      const result = await manager.getPolicy('user-1');

      expect(result.id).toBe('default');
    });

    it('should use medium as default priority', async () => {
      mockGetRawConfig.mockResolvedValue(null);

      await manager.getPolicy('user-1');

      expect(mockGetRawConfig).toHaveBeenCalledWith('ESCALATION_POLICY#user-1_medium');
    });

    it('should return default policy on error', async () => {
      mockGetRawConfig.mockRejectedValue(new Error('DynamoDB error'));

      const result = await manager.getPolicy('user-1');

      expect(result.id).toBe('default');
    });
  });

  describe('savePolicy', () => {
    it('should save user-specific policy', async () => {
      const policy = {
        id: 'policy-1',
        name: 'Test',
        priority: 'high',
        enabled: true,
        levels: [],
      } as any;

      await manager.savePolicy('user-1', policy);

      expect(mockSaveRawConfig).toHaveBeenCalledWith(
        'ESCALATION_POLICY#user-1_high',
        policy,
        expect.objectContaining({ author: 'user-1' })
      );
    });

    it('should save global policy', async () => {
      const policy = {
        id: 'global-1',
        name: 'Global',
        priority: 'medium',
        enabled: true,
        levels: [],
      } as any;

      await manager.savePolicy('global', policy);

      expect(mockSaveRawConfig).toHaveBeenCalledWith(
        'ESCALATION_POLICY#global_medium',
        policy,
        expect.objectContaining({ author: 'global' })
      );
    });

    it('should throw on save error', async () => {
      mockSaveRawConfig.mockRejectedValue(new Error('Write failed'));

      await expect(
        manager.savePolicy('user-1', { id: 'p1', priority: 'low' } as any)
      ).rejects.toThrow('Write failed');
    });
  });

  describe('startEscalation', () => {
    it('should start escalation and sync status with memory', async () => {
      mockGetRawConfig.mockResolvedValue(null);

      const state = await manager.startEscalation(
        'trace-1',
        'agent-1',
        'user-1',
        'What is your name?',
        'Identify yourself',
        'session-1'
      );

      expect(state.currentLevel).toBe(1);
      expect(state.completed).toBe(false);
      expect(state.traceId).toBe('trace-1');
      expect(state.agentId).toBe('agent-1');
      expect(state.userId).toBe('user-1');
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

    it('should throw if escalation policy is disabled', async () => {
      const disabledPolicy = {
        id: 'disabled',
        priority: 'medium',
        enabled: false,
        levels: [{ level: 1, timeoutMs: 1000, channels: ['telegram'], continueOnFailure: false }],
      };
      mockGetRawConfig.mockResolvedValue(disabledPolicy);

      await expect(
        manager.startEscalation('trace-1', 'agent-1', 'user-1', 'Q', 'Task')
      ).rejects.toThrow('Escalation policy is disabled');
    });

    it('should throw if policy has no levels', async () => {
      const emptyPolicy = {
        id: 'empty',
        priority: 'medium',
        enabled: true,
        levels: [],
      };
      mockGetRawConfig.mockResolvedValue(emptyPolicy);

      await expect(
        manager.startEscalation('trace-1', 'agent-1', 'user-1', 'Q', 'Task')
      ).rejects.toThrow('Escalation policy has no levels defined');
    });

    it('should use policyId when provided', async () => {
      const customPolicy = {
        id: 'custom',
        priority: 'high',
        enabled: true,
        levels: [{ level: 1, timeoutMs: 5000, channels: ['telegram'], continueOnFailure: false }],
        finalAction: 'fail',
      };
      mockGetRawConfig.mockResolvedValue(customPolicy);

      await manager.startEscalation(
        'trace-1',
        'agent-1',
        'user-1',
        'Q',
        'Task',
        undefined,
        'custom'
      );

      expect(mockGetRawConfig).toHaveBeenCalledWith('ESCALATION_POLICY#id_custom');
    });

    it('should set correct expiration time for first level', async () => {
      mockGetRawConfig.mockResolvedValue(null);
      const before = Date.now();

      const state = await manager.startEscalation('trace-1', 'agent-1', 'user-1', 'Q', 'Task');

      const after = Date.now();
      expect(state.currentLevelExpiresAt).toBeGreaterThanOrEqual(before + 300000);
      expect(state.currentLevelExpiresAt).toBeLessThanOrEqual(after + 300000);
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
        policyId: 'default',
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

    it('should return early if no escalation state found', async () => {
      mockGetEscalationState.mockResolvedValue(null);

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockSaveEscalationState).not.toHaveBeenCalled();
    });

    it('should return early if escalation already completed', async () => {
      mockGetEscalationState.mockResolvedValue({
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 2,
        policyId: 'default',
        completed: true,
      });

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockSaveEscalationState).not.toHaveBeenCalled();
    });

    it('should handle invalid escalation level by completing with failed', async () => {
      const mockState = {
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 99,
        policyId: 'default',
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
    });

    it('should not continue if continueOnFailure is false', async () => {
      const customPolicy = {
        id: 'single-level',
        priority: 'medium',
        enabled: true,
        levels: [{ level: 1, timeoutMs: 1000, channels: ['telegram'], continueOnFailure: false }],
        finalAction: 'fail',
      };
      mockGetRawConfig.mockResolvedValue(customPolicy);

      const mockState = {
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 1,
        policyId: 'single-level',
        completed: false,
      };
      mockGetEscalationState.mockResolvedValue(mockState);

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.ESCALATION_COMPLETED,
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle errors gracefully', async () => {
      mockGetEscalationState.mockRejectedValue(new Error('DynamoDB down'));

      await expect(
        manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task')
      ).resolves.not.toThrow();
    });
  });

  describe('markAnswered', () => {
    it('should mark escalation as answered', async () => {
      mockGetEscalationState.mockResolvedValue({
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 1,
        policyId: 'default',
        completed: false,
      });

      await manager.markAnswered('trace-1', 'agent-1');

      expect(mockSaveEscalationState).toHaveBeenCalledWith(
        expect.objectContaining({ completed: true, outcome: 'answered' })
      );
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.ESCALATION_COMPLETED,
        expect.objectContaining({ outcome: 'answered' }),
        expect.any(Object)
      );
    });

    it('should not modify already completed escalation', async () => {
      mockGetEscalationState.mockResolvedValue({
        traceId: 'trace-1',
        agentId: 'agent-1',
        completed: true,
      });

      await manager.markAnswered('trace-1', 'agent-1');

      expect(mockSaveEscalationState).not.toHaveBeenCalled();
    });

    it('should handle no state found gracefully', async () => {
      mockGetEscalationState.mockResolvedValue(null);

      await expect(manager.markAnswered('trace-1', 'agent-1')).resolves.not.toThrow();
      expect(mockSaveEscalationState).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockGetEscalationState.mockRejectedValue(new Error('DB error'));

      await expect(manager.markAnswered('trace-1', 'agent-1')).resolves.not.toThrow();
    });
  });

  describe('getEscalationState', () => {
    it('should return escalation state', async () => {
      const state = { traceId: 'trace-1', agentId: 'agent-1', completed: false };
      mockGetEscalationState.mockResolvedValue(state);

      const result = await manager.getEscalationState('trace-1', 'agent-1');

      expect(result).toEqual(state);
    });

    it('should return null on error', async () => {
      mockGetEscalationState.mockImplementation(() => {
        const err: any = { message: 'DB error', name: 'Error' };
        throw err;
      });

      const result = await manager.getEscalationState('trace-1', 'agent-1');

      expect(result).toBeNull();
    });
  });

  describe('final actions', () => {
    it('should handle continue_with_defaults final action', async () => {
      const policy = {
        id: 'defaults-policy',
        priority: 'medium',
        enabled: true,
        levels: [{ level: 1, timeoutMs: 1000, channels: ['telegram'], continueOnFailure: false }],
        finalAction: 'continue_with_defaults',
      };
      mockGetRawConfig.mockResolvedValue(policy);
      mockGetEscalationState.mockResolvedValue({
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 1,
        policyId: 'defaults-policy',
        completed: false,
      });

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.ESCALATION_COMPLETED,
        expect.objectContaining({ outcome: 'continued_with_defaults' }),
        expect.any(Object)
      );
      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'escalation-manager',
        'user-1',
        expect.stringContaining('Continued with Defaults'),
        undefined,
        undefined,
        'SystemGuard',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('should handle escalate_to_admin final action', async () => {
      const policy = {
        id: 'admin-policy',
        priority: 'critical',
        enabled: true,
        levels: [{ level: 1, timeoutMs: 1000, channels: ['telegram'], continueOnFailure: false }],
        finalAction: 'escalate_to_admin',
        adminUserIds: ['admin-1', 'admin-2'],
      };
      mockGetRawConfig.mockResolvedValue(policy);
      mockGetEscalationState.mockResolvedValue({
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 1,
        policyId: 'admin-policy',
        completed: false,
      });

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockSendOutboundMessage).toHaveBeenCalledTimes(2);
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.ESCALATION_COMPLETED,
        expect.objectContaining({ outcome: 'escalated_to_admin' }),
        expect.any(Object)
      );
    });

    it('should fail if no admin users configured for escalate_to_admin', async () => {
      const policy = {
        id: 'admin-no-users',
        priority: 'critical',
        enabled: true,
        levels: [{ level: 1, timeoutMs: 1000, channels: ['telegram'], continueOnFailure: false }],
        finalAction: 'escalate_to_admin',
        adminUserIds: [],
      };
      mockGetRawConfig.mockResolvedValue(policy);
      mockGetEscalationState.mockResolvedValue({
        traceId: 'trace-1',
        agentId: 'agent-1',
        userId: 'user-1',
        currentLevel: 1,
        policyId: 'admin-no-users',
        completed: false,
      });

      await manager.handleLevelTimeout('trace-1', 'agent-1', 'Q', 'Task');

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'escalation-manager',
        EventType.ESCALATION_COMPLETED,
        expect.objectContaining({ outcome: 'failed' }),
        expect.any(Object)
      );
    });
  });

  describe('channel notifications', () => {
    it('should send notifications for EMAIL channel (log only)', async () => {
      const policy = {
        id: 'email-policy',
        priority: 'medium',
        enabled: true,
        levels: [
          {
            level: 1,
            timeoutMs: 1000,
            channels: ['email'],
            continueOnFailure: false,
          },
        ],
        finalAction: 'fail',
      };
      mockGetRawConfig.mockResolvedValue(policy);

      await manager.startEscalation('trace-1', 'agent-1', 'user-1', 'Q', 'Task');

      expect(mockSendOutboundMessage).not.toHaveBeenCalled();
    });

    it('should send notifications for SMS channel (log only)', async () => {
      const policy = {
        id: 'sms-policy',
        priority: 'medium',
        enabled: true,
        levels: [
          {
            level: 1,
            timeoutMs: 1000,
            channels: ['sms'],
            continueOnFailure: false,
          },
        ],
        finalAction: 'fail',
      };
      mockGetRawConfig.mockResolvedValue(policy);

      await manager.startEscalation('trace-1', 'agent-1', 'user-1', 'Q', 'Task');

      expect(mockSendOutboundMessage).not.toHaveBeenCalled();
    });

    it('should continue with other channels if one fails', async () => {
      const policy = {
        id: 'multi-channel',
        priority: 'medium',
        enabled: true,
        levels: [
          {
            level: 1,
            timeoutMs: 1000,
            channels: ['telegram', 'slack'],
            continueOnFailure: false,
          },
        ],
        finalAction: 'fail',
      };
      mockGetRawConfig.mockResolvedValue(policy);
      mockSendOutboundMessage.mockRejectedValueOnce(new Error('Channel failed'));

      await manager.startEscalation('trace-1', 'agent-1', 'user-1', 'Q', 'Task');

      expect(mockSendOutboundMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('message formatting', () => {
    it('should format message with template variables', async () => {
      mockGetRawConfig.mockResolvedValue(null);

      await manager.startEscalation('trace-1', 'agent-1', 'user-1', 'What?', 'Do thing', 'sess-1');

      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'escalation-manager',
        'user-1',
        expect.stringContaining('What?'),
        undefined,
        'sess-1',
        'SystemGuard',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });
  });
});
