/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { useRealtime } from './useRealtime';
import { RealtimeProvider } from '@/components/Providers/RealtimeProvider';
import { TenantProvider } from '@/components/Providers/TenantProvider';

describe('useRealtime end-to-end handshake', () => {
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

  it('registers callback and remains stable under provider', async () => {
    const onMessage = vi.fn();

    function TestComp() {
      useRealtime({ userId: 'integration-user', onMessage, topics: ['workspaces/abc/#'] });
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
      expect((global as any).fetch).toHaveBeenCalledWith('/api/config');
    });
    expect(onMessage).not.toHaveBeenCalled();
  });
});
