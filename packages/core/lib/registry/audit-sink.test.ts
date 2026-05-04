import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditSinkRegistry, AuditEvent } from './audit-sink';

describe('AuditSinkRegistry', () => {
  beforeEach(() => {
    AuditSinkRegistry.clear();
  });

  it('broadcasts events to registered sinks', async () => {
    const onEvent = vi.fn();
    AuditSinkRegistry.register({ onEvent });

    const event: Omit<AuditEvent, 'timestamp'> = {
      type: 'safety_violation',
      agentId: 'test-agent',
      details: { foo: 'bar' },
    };

    await AuditSinkRegistry.broadcast(event);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety_violation',
        agentId: 'test-agent',
        details: { foo: 'bar' },
        timestamp: expect.any(Number),
      })
    );
  });

  it('handles multiple sinks', async () => {
    const onEvent1 = vi.fn();
    const onEvent2 = vi.fn();

    AuditSinkRegistry.register({ onEvent: onEvent1 });
    AuditSinkRegistry.register({ onEvent: onEvent2 });

    await AuditSinkRegistry.broadcast({ type: 'anomaly', agentId: 'test' } as any);

    expect(onEvent1).toHaveBeenCalled();
    expect(onEvent2).toHaveBeenCalled();
  });

  it('survives sink errors', async () => {
    const onEvent1 = vi.fn().mockImplementation(() => {
      throw new Error('Boom');
    });
    const onEvent2 = vi.fn();

    AuditSinkRegistry.register({ onEvent: onEvent1 });
    AuditSinkRegistry.register({ onEvent: onEvent2 });

    await AuditSinkRegistry.broadcast({ type: 'security_block', agentId: 'test' } as any);

    expect(onEvent1).toHaveBeenCalled();
    expect(onEvent2).toHaveBeenCalled();
  });
});
