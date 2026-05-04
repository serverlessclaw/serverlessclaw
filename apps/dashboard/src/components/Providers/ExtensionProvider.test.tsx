// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtensionProvider, useExtensions } from './ExtensionProvider';
import { Layout } from 'lucide-react';

// Unmock the global mock from test-setup.ts to test the real implementation
vi.unmock('@/components/Providers/ExtensionProvider');

const TestComponent = () => {
  const {
    sidebarExtensions,
    registerSidebarExtension,
    registerDynamicComponent,
    registerLayoutExtension,
  } = useExtensions();

  return (
    <div>
      <div data-testid="sidebar-count">{sidebarExtensions.length}</div>
      <button
        onClick={() => {
          registerSidebarExtension({
            id: 'ext-1',
            label: 'Ext 1',
            href: '/ext-1',
            icon: Layout,
          });
        }}
      >
        Add Sidebar
      </button>
      <button
        onClick={() => {
          registerDynamicComponent({
            type: 'test-type',
            component: () => <div>Dynamic</div>,
          });
        }}
      >
        Add Dynamic
      </button>
      <button
        onClick={() => {
          registerLayoutExtension({
            id: 'lay-1',
            slot: 'sidebar_top',
            component: () => <div>Layout</div>,
          });
        }}
      >
        Add Layout
      </button>
    </div>
  );
};

describe('ExtensionProvider', () => {
  it('provides extension context and handles registrations', async () => {
    render(
      <ExtensionProvider>
        <TestComponent />
      </ExtensionProvider>
    );

    expect(screen.getByTestId('sidebar-count').textContent).toBe('0');

    // Register sidebar extension
    fireEvent.click(screen.getByText('Add Sidebar'));
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-count').textContent).toBe('1');
    });

    // Register dynamic component
    fireEvent.click(screen.getByText('Add Dynamic'));

    // Register layout extension
    fireEvent.click(screen.getByText('Add Layout'));

    // Test duplicate layout extension (click again)
    fireEvent.click(screen.getByText('Add Layout'));
  });

  it('throws error when useExtensions is used outside of ExtensionProvider', () => {
    const TestError = () => {
      try {
        useExtensions();
      } catch (e: unknown) {
        return <div data-testid="error-msg">{(e as Error).message}</div>;
      }
      return <div data-testid="no-error">No error thrown</div>;
    };

    render(<TestError />);
    expect(screen.getByTestId('error-msg').textContent).toBe(
      'useExtensions must be used within an ExtensionProvider'
    );
  });
});
