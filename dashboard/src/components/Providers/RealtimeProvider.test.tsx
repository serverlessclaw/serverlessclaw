/**
 * @vitest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RealtimeProvider } from './RealtimeProvider';
import { useRealtime } from '@/hooks/useRealtime';

const mqttState = vi.hoisted(() => {
  const connections: Array<{ url: string; options: any; client: any }> = [];

  const connect = vi.fn((url: string, options: any) => {
    const client: any = {
      connected: false,
      _events: {},
      subscribe: vi.fn(),
      end: vi.fn(),
      on(event: string, cb: any) {
        this._events[event] = cb;
        return this;
      },
    };

    connections.push({ url, options, client });
    return client;
  });

  return { connections, connect };
});

vi.mock('mqtt', () => ({
  default: { connect: mqttState.connect },
}));

function configResponse() {
  return {
    json: async () => ({
      realtime: {
        url: 'wss://example.com/mqtt',
        authorizer: 'TestAuth',
      },
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('RealtimeProvider loop prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mqttState.connections.length = 0;

    (globalThis as any).fetch = vi.fn(async () => configResponse());

    const store: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key) => store[key] || null),
        setItem: vi.fn((key, val) => {
          store[key] = val;
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  it('disables mqtt auto-reconnect to avoid repeated authorizer invokes', async () => {
    render(
      <RealtimeProvider>
        <div>child</div>
      </RealtimeProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });

    const [{ options }] = mqttState.connections;
    expect(options.reconnectPeriod).toBe(0);
  });

  it('force-ends mqtt client during unmount cleanup', async () => {
    const { unmount } = render(
      <RealtimeProvider>
        <div>child</div>
      </RealtimeProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });

    const [{ client }] = mqttState.connections;
    unmount();

    expect(client.end).toHaveBeenCalledWith(true);
  });

  it('does not create a client after unmount when config fetch resolves late', async () => {
    const pending = deferred<any>();
    (globalThis as any).fetch = vi.fn(() => pending.promise);

    const { unmount } = render(
      <RealtimeProvider>
        <div>child</div>
      </RealtimeProvider>
    );

    unmount();
    pending.resolve(configResponse());

    await Promise.resolve();
    await Promise.resolve();

    expect(mqttState.connect).not.toHaveBeenCalled();
  });

  it('is strict-mode safe and does not create duplicate mqtt clients', async () => {
    render(
      <React.StrictMode>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });
  });

  it('force-ends client on error to stop reconnect churn', async () => {
    render(
      <RealtimeProvider>
        <div>child</div>
      </RealtimeProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });

    const [{ client }] = mqttState.connections;
    act(() => {
      client._events.error(new Error('mqtt failed'));
    });

    expect(client.end).toHaveBeenCalledWith(true);
  });

  it('routes wildcard topic messages to subscribed hook callbacks', async () => {
    const onMessage = vi.fn();

    function Consumer() {
      useRealtime({
        userId: 'test-user',
        topics: ['workspaces/#'],
        onMessage,
      });
      return <div>Consumer</div>;
    }

    render(
      <RealtimeProvider>
        <Consumer />
      </RealtimeProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });

    const [{ client }] = mqttState.connections;
    client._events.message(
      'workspaces/alpha/signal',
      Buffer.from(JSON.stringify({ 'detail-type': 'task_completed', detail: {} }))
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});
