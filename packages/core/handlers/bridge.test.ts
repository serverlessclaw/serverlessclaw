import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('@aws-sdk/client-iot-data-plane', () => ({
  IoTDataPlaneClient: class {
    send = (...args: any[]) => mockSend(...args);
  },
  PublishCommand: class {
    constructor(public input: any) {
      Object.assign(this, input);
    }
  },
}));

vi.mock('sst', () => ({
  Resource: {
    App: { name: 'serverlessclaw', stage: 'local' },
  },
}));

const fakeContext = {} as any;

/**
 * Creates a mock BridgeEvent with controllable detail fields.
 */
function createEvent(detailOverrides: any = {}) {
  return {
    'detail-type': 'chunk',
    detail: {
      userId: 'dashboard-user',
      sessionId: 'sess-1',
      traceId: 'trace-123',
      message: 'Hello world',
      source: 'superclaw',
      ...detailOverrides,
    },
  };
}

describe('RealtimeBridge Handler', () => {
  let handler: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('./bridge');
    handler = module.handler;
  });

  it('publishes chunk events to the session-specific IoT topic', async () => {
    const event = createEvent();

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/users/dashboard-user/sessions/sess-1/signal',
        }),
      })
    );
  });

  it('falls back to user signal topic when sessionId is missing', async () => {
    const event = createEvent({ sessionId: undefined });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/users/dashboard-user/signal',
        }),
      })
    );
  });

  it('sanitizes userId with MQTT-unsafe characters', async () => {
    const event = createEvent({ userId: 'user+with#special' });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/users/user_with_special/sessions/sess-1/signal',
        }),
      })
    );
  });

  it('defaults userId to dashboard-user when missing', async () => {
    const event = createEvent({ userId: undefined });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/users/dashboard-user/sessions/sess-1/signal',
        }),
      })
    );
  });

  it('normalizes userId with CONV# prefix for MQTT topics', async () => {
    const event = createEvent({ userId: 'CONV#dashboard-user#sess-1' });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/users/dashboard-user/sessions/sess-1/signal',
        }),
      })
    );
  });

  it('does not publish when event schema validation fails', async () => {
    const event = { 'detail-type': 'chunk', detail: { userId: 123 } }; // Invalid userId type

    await handler(event as any, fakeContext);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('passes thought chunks through to IoT Core unchanged', async () => {
    const event = createEvent({ isThought: true, message: 'Thinking...' });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          payload: expect.anything(),
        }),
      })
    );

    const call = mockSend.mock.calls[0][0];
    const payload = JSON.parse(call.input.payload.toString());
    expect(payload.isThought).toBe(true);
    expect(payload.message).toBe('Thinking...');
  });

  it('routes to collaboration topic when collaborationId is present', async () => {
    const event = createEvent({ collaborationId: 'collab-123' });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/collaborations/collab-123/signal',
        }),
      })
    );
  });

  it('routes to workspace topic when workspaceId is present (and no collaborationId)', async () => {
    const event = createEvent({ workspaceId: 'ws-456' });

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/workspaces/ws-456/signal',
        }),
      })
    );
  });

  it('routes to system/metrics topic for health and metric events', async () => {
    const event = {
      'detail-type': 'system_health_report',
      detail: {
        userId: 'system',
        message: 'Disk full',
        traceId: 'trace-999',
      },
    };

    await handler(event as any, fakeContext);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          topic: 'serverlessclaw/local/system/metrics',
        }),
      })
    );
  });
});
