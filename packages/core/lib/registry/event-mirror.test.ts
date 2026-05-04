import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventMirrorRegistry, AgentBusEvent } from './event-mirror';

describe('EventMirrorRegistry', () => {
  beforeEach(() => {
    EventMirrorRegistry.clear();
  });

  it('mirrors events to registered subscribers', async () => {
    const onEvent = vi.fn();
    EventMirrorRegistry.register({ onEvent });

    const event: AgentBusEvent = {
      source: 'test-source',
      detailType: 'test-event',
      detail: { foo: 'bar' },
    };

    await EventMirrorRegistry.mirror(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('handles multiple mirrors', async () => {
    const onEvent1 = vi.fn();
    const onEvent2 = vi.fn();

    EventMirrorRegistry.register({ onEvent: onEvent1 });
    EventMirrorRegistry.register({ onEvent: onEvent2 });

    await EventMirrorRegistry.mirror({ source: 'test' } as any);

    expect(onEvent1).toHaveBeenCalled();
    expect(onEvent2).toHaveBeenCalled();
  });

  it('survives mirror errors', async () => {
    const onEvent1 = vi.fn().mockImplementation(() => {
      throw new Error('Mirror fail');
    });
    const onEvent2 = vi.fn();

    EventMirrorRegistry.register({ onEvent: onEvent1 });
    EventMirrorRegistry.register({ onEvent: onEvent2 });

    await EventMirrorRegistry.mirror({ source: 'test' } as any);

    expect(onEvent1).toHaveBeenCalled();
    expect(onEvent2).toHaveBeenCalled();
  });
});
