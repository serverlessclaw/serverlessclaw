import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MissionControlRegistry, MissionSignal } from './mission-control';

describe('MissionControlRegistry', () => {
  beforeEach(() => {
    MissionControlRegistry.clear();
  });

  it('emits signals to registered observers', async () => {
    const onSignal = vi.fn();
    MissionControlRegistry.register({ onSignal });
    
    const signal: Omit<MissionSignal, 'timestamp'> = {
      type: 'milestone_reached',
      agentId: 'agent-1',
      traceId: 'trace-A',
      payload: { milestone: 'started' }
    };
    
    await MissionControlRegistry.signal(signal);
    
    expect(onSignal).toHaveBeenCalledWith(expect.objectContaining({
      type: 'milestone_reached',
      agentId: 'agent-1',
      traceId: 'trace-A',
      payload: { milestone: 'started' },
      timestamp: expect.any(Number)
    }));
  });

  it('handles multiple observers', async () => {
    const onSignal1 = vi.fn();
    const onSignal2 = vi.fn();
    
    MissionControlRegistry.register({ onSignal: onSignal1 });
    MissionControlRegistry.register({ onSignal: onSignal2 });
    
    await MissionControlRegistry.signal({ type: 'strategy_update' } as any);
    
    expect(onSignal1).toHaveBeenCalled();
    expect(onSignal2).toHaveBeenCalled();
  });
});
