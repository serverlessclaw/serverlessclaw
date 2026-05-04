// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TenantProvider, useTenant } from './TenantProvider';

// Mock fetch
const globalFetch = vi.fn();
vi.stubGlobal('fetch', globalFetch);

const TestComponent = () => {
  const { activeWorkspaceId, setActiveWorkspace, workspaces, isLoading, refreshWorkspaces } =
    useTenant();
  return (
    <div>
      <div data-testid="workspace-id">{activeWorkspaceId || 'none'}</div>
      <div data-testid="loading-status">{isLoading ? 'Loading' : 'Loaded'}</div>
      <div data-testid="workspace-count">{workspaces.length}</div>
      <button onClick={() => setActiveWorkspace('new-id')}>Set Workspace</button>
      <button onClick={() => refreshWorkspaces()}>Refresh</button>
    </div>
  );
};

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('TenantProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalFetch.mockReset();
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { id: '1', name: 'W1', orgId: 'o1' },
          { id: '2', name: 'W2', orgId: 'o2' },
        ],
      }),
    });
  });

  it('loads workspace from localStorage and fetches on mount', async () => {
    localStorage.setItem('claw_active_workspace', '1');
    render(
      <TenantProvider>
        <TestComponent />
      </TenantProvider>
    );

    expect(screen.getByTestId('loading-status')).toHaveTextContent('Loading');

    await waitFor(() => {
      expect(screen.getByTestId('workspace-id')).toHaveTextContent('1');
      expect(screen.getByTestId('workspace-count')).toHaveTextContent('2');
      expect(screen.getByTestId('loading-status')).toHaveTextContent('Loaded');
    });

    expect(globalFetch).toHaveBeenCalledWith('/api/workspaces');
  });

  it('updates active workspace and localStorage', async () => {
    render(
      <TenantProvider>
        <TestComponent />
      </TenantProvider>
    );

    fireEvent.click(screen.getByText('Set Workspace'));

    expect(screen.getByTestId('workspace-id')).toHaveTextContent('new-id');
    expect(localStorage.getItem('claw_active_workspace')).toBe('new-id');
  });

  it('handles fetch errors gracefully', async () => {
    globalFetch.mockRejectedValue(new Error('Fetch failed'));
    render(
      <TenantProvider>
        <TestComponent />
      </TenantProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading-status')).toHaveTextContent('Loaded');
      expect(screen.getByTestId('workspace-count')).toHaveTextContent('0');
    });
  });

  it('throws error if useTenant is used outside of provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestComponent />)).toThrow(
      'useTenant must be used within a TenantProvider'
    );
    consoleSpy.mockRestore();
  });

  it('refreshes workspaces on demand', async () => {
    render(
      <TenantProvider>
        <TestComponent />
      </TenantProvider>
    );

    await waitFor(() => expect(globalFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Refresh'));
    expect(globalFetch).toHaveBeenCalledTimes(2);
  });
});
