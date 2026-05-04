// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Slot } from './Slot';
import React from 'react';

// Mock dependencies
const mockUseExtensions = vi.fn();
vi.mock('@/components/Providers/ExtensionProvider', () => ({
  useExtensions: () => mockUseExtensions(),
}));

describe('Slot Component', () => {
  it('renders registered extensions for the given slot', () => {
    const TestComponent = () => <div data-testid="test-ext">Extension Content</div>;

    mockUseExtensions.mockReturnValue({
      layoutExtensions: new Map([
        ['sidebar_top', [{ id: 'ext1', slot: 'sidebar_top', component: TestComponent }]],
      ]),
    });

    render(<Slot name="sidebar_top" />);

    expect(screen.getByTestId('test-ext')).toBeInTheDocument();
    expect(screen.getByText('Extension Content')).toBeInTheDocument();
  });

  it('renders multiple extensions for the same slot', () => {
    const Ext1 = () => <div data-testid="ext1">Ext 1</div>;
    const Ext2 = () => <div data-testid="ext2">Ext 2</div>;

    mockUseExtensions.mockReturnValue({
      layoutExtensions: new Map([
        [
          'sidebar_top',
          [
            { id: 'ext1', slot: 'sidebar_top', component: Ext1 },
            { id: 'ext2', slot: 'sidebar_top', component: Ext2 },
          ],
        ],
      ]),
    });

    render(<Slot name="sidebar_top" />);

    expect(screen.getByTestId('ext1')).toBeInTheDocument();
    expect(screen.getByTestId('ext2')).toBeInTheDocument();
  });

  it('renders fallback when no extensions are registered', () => {
    mockUseExtensions.mockReturnValue({
      layoutExtensions: new Map(),
    });

    render(<Slot name="sidebar_top" fallback={<div data-testid="fallback">Fallback</div>} />);

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('renders nothing when no extensions and no fallback', () => {
    mockUseExtensions.mockReturnValue({
      layoutExtensions: new Map(),
    });

    const { container } = render(<Slot name="sidebar_top" />);
    expect(container.firstChild).toBeNull();
  });
});
