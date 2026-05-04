// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import UICommand from './UICommand';
import { useRouter } from 'next/navigation';
import { DynamicComponent } from '@claw/hooks';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

describe('UICommand', () => {
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as unknown as ReturnType<
      typeof useRouter
    >);
  });

  it('performs auto-navigation', () => {
    const component = {
      componentType: 'ui-command',
      id: '1',
      props: {
        command: 'navigation',
        mode: 'auto',
        path: '/playground',
        params: { id: 'test' },
      },
    };
    render(<UICommand component={component as DynamicComponent} />);
    expect(mockPush).toHaveBeenCalledWith('/playground?id=test');
  });

  it('renders suggested view for HITL navigation', () => {
    const component = {
      componentType: 'ui-command',
      id: '2',
      props: {
        command: 'navigation',
        mode: 'hitl',
        path: '/security',
      },
    };
    render(<UICommand component={component as DynamicComponent} />);
    expect(screen.getByText(/suggested view: \/security/i)).toBeInTheDocument();
  });

  it('dispatches custom event for action commands', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const component = {
      componentType: 'ui-command',
      id: '3',
      props: {
        command: 'action',
        action: 'toggle_sidebar',
        target: 'sidebar',
        payload: { collapsed: true },
      },
    };
    render(<UICommand component={component as DynamicComponent} />);

    expect(dispatchSpy).toHaveBeenCalled();
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('claw:ui-command');
    expect(event.detail.action).toBe('toggle_sidebar');
  });
});
