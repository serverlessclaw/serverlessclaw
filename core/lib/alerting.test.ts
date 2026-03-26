import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./types/agent', () => ({
  EventType: { OUTBOUND_MESSAGE: 'outbound_message' },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { Alerting } from './alerting';
import { emitEvent } from './utils/bus';
import { EventType } from './types/agent';

describe('Alerting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('alertHighTokenUsage', () => {
    it('should emit high token usage alert', async () => {
      await Alerting.alertHighTokenUsage('agent-1', 5000, 1000);
      expect(emitEvent).toHaveBeenCalledWith(
        'system.alerting',
        EventType.OUTBOUND_MESSAGE,
        expect.objectContaining({
          userId: 'ADMIN',
          message: expect.stringContaining('High token usage alert'),
          agentName: 'Alerting',
        })
      );
    });

    it('should include token count and threshold in message', async () => {
      await Alerting.alertHighTokenUsage('coder', 8000, 2000);
      const call = (emitEvent as any).mock.calls[0];
      expect(call[2].message).toContain('8000');
      expect(call[2].message).toContain('2000');
    });
  });

  describe('alertCircuitBreakerOpen', () => {
    it('should emit circuit breaker alert', async () => {
      await Alerting.alertCircuitBreakerOpen('deploy');
      expect(emitEvent).toHaveBeenCalledWith(
        'system.alerting',
        EventType.OUTBOUND_MESSAGE,
        expect.objectContaining({
          userId: 'ADMIN',
          message: expect.stringContaining('Circuit breaker OPEN'),
        })
      );
    });
  });

  describe('alertDLQOverflow', () => {
    it('should emit DLQ overflow alert', async () => {
      await Alerting.alertDLQOverflow(15);
      expect(emitEvent).toHaveBeenCalledWith(
        'system.alerting',
        EventType.OUTBOUND_MESSAGE,
        expect.objectContaining({
          userId: 'ADMIN',
          message: expect.stringContaining('DLQ overflow'),
        })
      );
    });

    it('should include count in message', async () => {
      await Alerting.alertDLQOverflow(25);
      const call = (emitEvent as any).mock.calls[0];
      expect(call[2].message).toContain('25');
    });
  });

  describe('alertHighErrorRate', () => {
    it('should emit high error rate alert', async () => {
      await Alerting.alertHighErrorRate('planner', 0.45);
      expect(emitEvent).toHaveBeenCalledWith(
        'system.alerting',
        EventType.OUTBOUND_MESSAGE,
        expect.objectContaining({
          userId: 'ADMIN',
          message: expect.stringContaining('High error rate'),
        })
      );
    });

    it('should format rate as percentage', async () => {
      await Alerting.alertHighErrorRate('agent-1', 0.35);
      const call = (emitEvent as any).mock.calls[0];
      expect(call[2].message).toContain('35.0%');
    });
  });

  describe('error handling', () => {
    it('should not throw when emitEvent fails for token alert', async () => {
      (emitEvent as any).mockRejectedValueOnce(new Error('bus error'));
      await expect(Alerting.alertHighTokenUsage('agent-1', 1000, 500)).resolves.not.toThrow();
    });

    it('should not throw when emitEvent fails for circuit breaker alert', async () => {
      (emitEvent as any).mockRejectedValueOnce(new Error('bus error'));
      await expect(Alerting.alertCircuitBreakerOpen('deploy')).resolves.not.toThrow();
    });

    it('should not throw when emitEvent fails for DLQ alert', async () => {
      (emitEvent as any).mockRejectedValueOnce(new Error('bus error'));
      await expect(Alerting.alertDLQOverflow(10)).resolves.not.toThrow();
    });

    it('should not throw when emitEvent fails for error rate alert', async () => {
      (emitEvent as any).mockRejectedValueOnce(new Error('bus error'));
      await expect(Alerting.alertHighErrorRate('agent-1', 0.5)).resolves.not.toThrow();
    });
  });
});
