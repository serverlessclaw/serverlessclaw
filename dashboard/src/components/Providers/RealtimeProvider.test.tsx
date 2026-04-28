// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RealtimeProvider, useRealtimeContext } from './RealtimeProvider';
import { TenantProvider } from './TenantProvider';

// Mock mqtt
const mockMqttClient = {
  on: vi.fn(),
  subscribe: vi.fn(),
  end: vi.fn(),
  connected: true,
};
vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(() => mockMqttClient),
  },
}));

// Mock fetch
const globalFetch = vi.fn();
vi.stubGlobal('fetch', globalFetch);

const TestComponent = () => {
  const { isConnected, subscribe } = useRealtimeContext();
  React.useEffect(() => {
    const unsub = subscribe(['test/topic'], vi.fn());
    return unsub;
  }, [subscribe]);
  return <div data-testid="realtime-status">{isConnected ? 'Connected' : 'Disconnected'}</div>;
};

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalFetch.mockReset();
    globalFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        app: 'claw',
        stage: 'dev',
        realtime: { url: 'wss://test.com', authorizer: 'auth' },
        sessions: [],
      }),
    });
  });

  it('connects to MQTT on mount', async () => {
    render(
      <TenantProvider>
        <RealtimeProvider>
          <TestComponent />
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => {
      expect(globalFetch).toHaveBeenCalledWith('/api/config');
    });

    // Simulate connect event
    const connectCallback = mockMqttClient.on.mock.calls.find((call) => call[0] === 'connect')?.[1];
    connectCallback();

    await waitFor(() => {
      expect(screen.getByTestId('realtime-status')).toHaveTextContent('Connected');
    });
  });

  it('handles MQTT messages and subscriptions', async () => {
    const callback = vi.fn();
    let messageHandler: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;

    mockMqttClient.on.mockImplementation((event, handler) => {
      if (event === 'message') messageHandler = handler;
    });

    const SubTester = () => {
      const { subscribe } = useRealtimeContext();
      React.useEffect(() => {
        return subscribe(['custom/topic'], callback);
      }, [subscribe]);
      return null;
    };

    render(
      <TenantProvider>
        <RealtimeProvider>
          <SubTester />
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => expect(messageHandler).toBeDefined());

    // Simulate message
    const payload = JSON.stringify({ 'detail-type': 'test', detail: {} });
    messageHandler('claw/dev/custom/topic', Buffer.from(payload));

    expect(callback).toHaveBeenCalledWith('custom/topic', expect.any(Object));
  });

  it('handles MQTT wildcards', async () => {
    const callback = vi.fn();
    let messageHandler: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;

    mockMqttClient.on.mockImplementation((event, handler) => {
      if (event === 'message') messageHandler = handler;
    });

    const WildcardTester = () => {
      const { subscribe } = useRealtimeContext();
      React.useEffect(() => {
        return subscribe(['rooms/+/messages'], callback);
      }, [subscribe]);
      return null;
    };

    render(
      <TenantProvider>
        <RealtimeProvider>
          <WildcardTester />
        </RealtimeProvider>
      </TenantProvider>
    );

    await waitFor(() => expect(messageHandler).toBeDefined());

    const payload = JSON.stringify({ data: 'hello' });
    messageHandler('claw/dev/rooms/123/messages', Buffer.from(payload));

    expect(callback).toHaveBeenCalledWith('rooms/123/messages', expect.any(Object));
  });
});
