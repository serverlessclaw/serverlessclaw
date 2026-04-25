/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { useRealtime } from './useRealtime';
import { RealtimeProvider } from '@/components/Providers/RealtimeProvider';
import { TenantProvider } from '@/components/Providers/TenantProvider';

describe('useRealtime shared provider behavior', () => {
  beforeEach(() => {
    (global as any).fetch = vi.fn((url: string) => {
      if (url.includes('/api/workspaces')) {
        return Promise.resolve({
          json: () => Promise.resolve({ workspaces: [] }),
        });
      }
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            realtime: { url: 'wss://example.com/mqtt', authorizer: 'TestAuth' },
          }),
      });
    });
  });

  it('throws when used outside RealtimeProvider', () => {
    function TestComp() {
      useRealtime({ userId: 'integration-user' });
      return null;
    }

    expect(() =>
      render(React.createElement(TenantProvider, null, React.createElement(TestComp)))
    ).toThrow('useRealtimeContext must be used within a RealtimeProvider');
  });

  it('returns realtime state from shared provider', async () => {
    const states: boolean[] = [];

    function TestComp() {
      const { isConnected } = useRealtime({ userId: 'integration-user' });
      states.push(isConnected);
      return null;
    }

    render(
      React.createElement(
        TenantProvider,
        null,
        React.createElement(RealtimeProvider, null, React.createElement(TestComp))
      )
    );

    await waitFor(() => {
      expect(states.length).toBeGreaterThan(0);
    });
  });
});
