// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { UICommandProvider, useUICommand } from './UICommandProvider';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

const TestComponent = () => {
  const { activeModal, setActiveModal, isSidebarCollapsed, setSidebarCollapsed, lastCommand } =
    useUICommand();
  return (
    <div>
      <div data-testid="modal">{activeModal}</div>
      <div data-testid="sidebar">{isSidebarCollapsed ? 'collapsed' : 'expanded'}</div>
      <div data-testid="last-cmd">{lastCommand?.action}</div>
      <button onClick={() => setActiveModal('test-modal')}>Open Modal</button>
      <button onClick={() => setSidebarCollapsed(true)}>Collapse Sidebar</button>
    </div>
  );
};

describe('UICommandProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use a manual mock for localStorage if needed, but let's try to just test the state
  });

  it('updates state via context methods', async () => {
    render(
      <UICommandProvider>
        <TestComponent />
      </UICommandProvider>
    );

    fireEvent.click(screen.getByText('Open Modal'));
    expect(screen.getByTestId('modal')).toHaveTextContent('test-modal');

    fireEvent.click(screen.getByText('Collapse Sidebar'));
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toHaveTextContent('collapsed');
    });
  });

  it('responds to global claw:ui-command events', () => {
    render(
      <UICommandProvider>
        <TestComponent />
      </UICommandProvider>
    );

    // Test open_modal
    act(() => {
      window.dispatchEvent(
        new CustomEvent('claw:ui-command', {
          detail: { action: 'open_modal', target: 'agent-config' },
        })
      );
    });
    expect(screen.getByTestId('modal')).toHaveTextContent('agent-config');

    // Test close_modal
    act(() => {
      window.dispatchEvent(
        new CustomEvent('claw:ui-command', {
          detail: { action: 'close_modal', target: 'agent-config' },
        })
      );
    });
    expect(screen.getByTestId('modal')).toHaveTextContent('');

    // Test focus_resource (triggers toast)
    act(() => {
      window.dispatchEvent(
        new CustomEvent('claw:ui-command', {
          detail: { action: 'focus_resource', target: 'lambda-1' },
        })
      );
    });
    expect(toast).toHaveBeenCalledWith('Focusing resource: lambda-1');

    // Test toggle_sidebar
    act(() => {
      window.dispatchEvent(
        new CustomEvent('claw:ui-command', {
          detail: { action: 'toggle_sidebar', target: 'sidebar', payload: { collapsed: true } },
        })
      );
    });
    expect(screen.getByTestId('sidebar')).toHaveTextContent('collapsed');
  });

  it('throws error when useUICommand is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestComponent />)).toThrow(
      'useUICommand must be used within a UICommandProvider'
    );
    consoleSpy.mockRestore();
  });
});
