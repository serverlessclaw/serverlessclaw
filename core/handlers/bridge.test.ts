import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './bridge';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-iot-data-plane', () => ({
  IoTDataPlaneClient: function (this: any) {
    this.send = mockSend;
  },
  PublishCommand: function PublishCommand(this: any, args: any) {
    Object.assign(this, args);
  },
}));

const fakeContext = {} as any;

function chunkEvent(overrides: Record<string, unknown> = {}) {
  return {
    'detail-type': 'chunk',
    detail: {
      userId: 'dashboard-user',
      sessionId: 'sess-1',
      traceId: 'trace-123',
      messageId: 'trace-123',
      message: 'Hello world',
      isThought: false,
      agentName: 'SuperClaw',
      ...overrides,
    },
    source: 'superclaw',
    ...overrides,
  };
}

describe('RealtimeBridge Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes chunk events to the session-specific IoT topic', async () => {
    const event = chunkEvent();

    await handler(event, fakeContext);

    expect(mockSend).toHaveBeenCalled();
    const cmd = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(cmd.topic).toBe('users/dashboard-user/sessions/sess-1/signal');

    const payload = JSON.parse(cmd.payload.toString());
    expect(payload.userId).toBe('dashboard-user');
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.message).toBe('Hello world');
    expect(payload.agentName).toBe('SuperClaw');
  });

  it('falls back to user signal topic when sessionId is missing', async () => {
    const event = chunkEvent({ detail: { ...chunkEvent().detail, sessionId: undefined } });

    await handler(event, fakeContext);

    const cmd = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(cmd.topic).toBe('users/dashboard-user/signal');
  });

  it('sanitizes userId with MQTT-unsafe characters', async () => {
    const event = chunkEvent({ detail: { ...chunkEvent().detail, userId: 'user+with#special' } });

    await handler(event, fakeContext);

    const cmd = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(cmd.topic).toBe('users/user_with_special/sessions/sess-1/signal');
  });

  it('defaults userId to dashboard-user when missing', async () => {
    const event = chunkEvent({ detail: { ...chunkEvent().detail, userId: undefined } });

    await handler(event, fakeContext);

    const cmd = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(cmd.topic).toBe('users/dashboard-user/sessions/sess-1/signal');
  });

  it('normalizes userId with CONV# prefix for MQTT topics', async () => {
    const event = chunkEvent({
      detail: { ...chunkEvent().detail, userId: 'CONV#dashboard-user#sess-1' },
    });

    await handler(event, fakeContext);

    const cmd = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(cmd.topic).toBe('users/dashboard-user/sessions/sess-1/signal');
  });

  it('does not publish when event schema validation fails', async () => {
    // detail is required and must match BRIDGE_DETAIL_PAYLOAD_SCHEMA
    const event = { 'detail-type': 'chunk', detail: { userId: 123 } }; // Invalid userId type

    await handler(event as any, fakeContext);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('passes thought chunks through to IoT Core unchanged', async () => {
    const event = chunkEvent({
      detail: {
        ...chunkEvent().detail,
        message: 'Let me think...',
        isThought: true,
      },
    });

    await handler(event, fakeContext);

    const cmd = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    const payload = JSON.parse(cmd.payload.toString());
    expect(payload.isThought).toBe(true);
    expect(payload.message).toBe('Let me think...');
  });
});
