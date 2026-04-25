/**
 * @vitest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RealtimeProvider } from './RealtimeProvider';
import { TenantProvider } from './TenantProvider';
import { useRealtime } from '@/hooks/useRealtime';
import { logger } from '@claw/core/lib/logger';

vi.mock('@claw/core/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name === 'content-type' ? 'application/json' : null),
    },
    json: async () => ({
      app: 'test-app',
      stage: 'test-stage',
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

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('/api/workspaces')) {
        return {
          ok: true,
          json: async () => ({ workspaces: [] }),
        };
      }
      return configResponse();
    });

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

  it('enables mqtt auto-reconnect for resilient connection', async () => {
    render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => {
      expect(mqttState.connections.length).toBeGreaterThan(0);
    });

    const [{ options }] = mqttState.connections;
    expect(options.reconnectPeriod).toBeGreaterThan(0);
  });

  it('force-ends mqtt client during unmount cleanup', async () => {
    const { unmount } = render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
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
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
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
        <TenantProvider>
          <RealtimeProvider>
            <div>child</div>
          </RealtimeProvider>
        </TenantProvider>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });
  });

  it('does not force-end client on error to allow auto-reconnect', async () => {
    render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });

    const [{ client }] = mqttState.connections;
    act(() => {
      client._events.error(new Error('mqtt failed'));
    });

    expect(client.end).not.toHaveBeenCalled();
  });

  it('routes wildcard topic messages to subscribed hook callbacks', async () => {
    const onMessage = vi.fn();

    function Consumer() {
      useRealtime({
        userId: 'test-user',
        topics: ['workspaces/#', 'users/+/signal'],
        onMessage,
      });
      return <div>Consumer</div>;
    }

    render(
      <TenantProvider>
        <RealtimeProvider>
          <Consumer />
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalledTimes(1);
    });

    const [{ client }] = mqttState.connections;

    // Test '#' wildcard
    act(() => {
      client._events.message(
        'test-app/test-stage/workspaces/alpha/signal',
        Buffer.from(JSON.stringify({ 'detail-type': 'task_completed', detail: {} }))
      );
    });
    expect(onMessage).toHaveBeenCalledWith('workspaces/alpha/signal', expect.anything());

    // Test '+' wildcard
    act(() => {
      client._events.message(
        'test-app/test-stage/users/user123/signal',
        Buffer.from(JSON.stringify({ 'detail-type': 'chunk', detail: {} }))
      );
    });
    expect(onMessage).toHaveBeenCalledWith('users/user123/signal', expect.anything());

    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it('correctly constructs canonical AWS IoT WebSocket URL', async () => {
    render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => {
      expect(mqttState.connect).toHaveBeenCalled();
    });

    const [{ url }] = mqttState.connections;
    expect(url).toContain('wss://example.com/mqtt');
    expect(url).toContain('x-amz-customauthorizer-name=TestAuth');
    expect(url).toContain('x-amz-customauthorizer-token=dashboard-dev-token-elegant');
    expect(url).toContain('clientId=dash_');
  });

  it('handles empty config response gracefully', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      json: async () => ({}),
    }));

    render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
    );

    // Wait a bit to ensure it doesn't crash
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mqttState.connect).not.toHaveBeenCalled();
  });

  it('handles message parse errors without crashing', async () => {
    const onMessage = vi.fn();
    function Consumer() {
      useRealtime({ topics: ['#'], onMessage });
      return null;
    }

    render(
      <TenantProvider>
        <RealtimeProvider>
          <Consumer />
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => expect(mqttState.connect).toHaveBeenCalled());
    const [{ client }] = mqttState.connections;

    act(() => {
      client._events.message('test', Buffer.from('invalid-json'));
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('logs reconnect and offline events', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => expect(mqttState.connect).toHaveBeenCalled());
    const [{ client }] = mqttState.connections;

    act(() => {
      client._events.reconnect();
    });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));

    act(() => {
      client._events.offline();
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('went offline'));
  });

  it('handles failed config fetch gracefully', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(
      <TenantProvider>
        <RealtimeProvider>
          <div>child</div>
        </RealtimeProvider>
      </TenantProvider>
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mqttState.connect).not.toHaveBeenCalled();
  });
});
