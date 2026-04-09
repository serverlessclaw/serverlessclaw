/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Integration-style test: mock mqtt client to simulate connect and message events
vi.mock('mqtt', () => {
  const client: any = {
    _events: {},
    on: function (ev: string, cb: any) {
      this._events[ev] = cb;
    },
    subscribe: vi.fn(),
    end: vi.fn(),
  };

  const connect = vi.fn(() => client);
  (globalThis as any).__MQTT_CONNECT_MOCK = connect;
  (globalThis as any).__LAST_MQTT_CLIENT = client;

  // Provide default-shaped export like the real `mqtt` package
  return { default: { connect } };
});

import { useRealtime } from './useRealtime';

describe('useRealtime end-to-end handshake', () => {
  beforeEach(() => {
    const connectMock = (globalThis as any).__MQTT_CONNECT_MOCK as ReturnType<typeof vi.fn>;
    if (connectMock?.mockReset) connectMock.mockReset();
    const client = (globalThis as any).__LAST_MQTT_CLIENT;
    if (client) {
      client.subscribe.mockReset?.();
      client.end.mockReset?.();
      client._events = {};
    }

    (localStorage.getItem as unknown as any).mockReturnValue(null);
    (localStorage.setItem as unknown as any).mockClear();
  });

  it('subscribes and dispatches incoming messages to onMessage handler', async () => {
    const onMessage = vi.fn();

    (global as any).fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            realtime: { url: 'wss://example.com/mqtt', authorizer: 'TestAuth' },
          }),
      })
    );

    function TestComp() {
      useRealtime({ userId: 'integration-user', onMessage, topics: ['workspaces/abc/#'] });
      return null;
    }

    render(React.createElement(TestComp));

    // Wait for connect to be called
    await waitFor(() => {
      const connectMock = (globalThis as any).__MQTT_CONNECT_MOCK as ReturnType<typeof vi.fn>;
      expect(connectMock).toHaveBeenCalled();
    });

    const client = (globalThis as any).__LAST_MQTT_CLIENT;

    // Simulate 'connect' lifecycle event
    client._events['connect'] && client._events['connect']();

    // Expect subscriptions to include the default user and supplied workspace topic
    await waitFor(() => {
      expect(client.subscribe).toHaveBeenCalledWith(expect.stringContaining('users/integration-user/#'));
      expect(client.subscribe).toHaveBeenCalledWith('workspaces/abc/#');
    });

    // Simulate an incoming MQTT message and ensure our handler receives it
    const payload = Buffer.from(JSON.stringify({ 'detail-type': 'REPL', detail: { msg: 'hello' } }));
    client._events['message'] && client._events['message']('users/integration-user/signal', payload);

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith(
        'users/integration-user/signal',
        expect.objectContaining({ 'detail-type': 'REPL', detail: { msg: 'hello' } })
      );
    });
  });
});
