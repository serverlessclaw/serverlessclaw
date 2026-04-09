/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Provide a mocked mqtt.connect and expose it via globalThis for assertions.
vi.mock('mqtt', () => {
  const connect = vi.fn(() => ({ on: vi.fn(), subscribe: vi.fn(), end: vi.fn() }));
  (globalThis as any).__MQTT_CONNECT_MOCK = connect;
  // Provide a default export shape that matches `import mqtt from 'mqtt'` usage
  return { default: { connect } };
});

import { useRealtime } from './useRealtime';

describe('useRealtime MQTT URL and token', () => {
  beforeEach(() => {
    // Reset mocked connect
    const connectMock = (globalThis as any).__MQTT_CONNECT_MOCK as ReturnType<typeof vi.fn>;
    connectMock.mockReset();
    // Ensure localStorage appears empty so the hook will generate and persist a token
    (localStorage.getItem as unknown as any).mockReturnValue(null);
    (localStorage.setItem as unknown as any).mockClear();
  });

  it('includes authorizer name and token query param in websocket URL', async () => {
    // Mock config fetch to return an authorizer and endpoint
    (global as any).fetch = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            realtime: { url: 'wss://example.com/mqtt', authorizer: 'TestAuth' },
          }),
      })
    );

    function TestComp() {
      useRealtime({ userId: 'integration-user' });
      return null;
    }

    render(React.createElement(TestComp));

    await waitFor(() => {
      const connectMock = (globalThis as any).__MQTT_CONNECT_MOCK as ReturnType<typeof vi.fn>;
      expect(connectMock).toHaveBeenCalled();
    });

    const connectMock = (globalThis as any).__MQTT_CONNECT_MOCK as ReturnType<typeof vi.fn>;
    const calledUrl = connectMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('x-amz-customauthorizer-name=TestAuth');
    expect(calledUrl).toMatch(/token=[A-Za-z0-9%]+/);
    expect(localStorage.setItem).toHaveBeenCalledWith('sc_realtime_token', expect.any(String));
  });
});
