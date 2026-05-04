// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContextPanel } from './ContextPanel';

// Mock translations
vi.mock('@/components/Providers/TranslationsProvider', () => ({
  useTranslations: () => ({ t: (k: string) => k }),
}));

describe('ContextPanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sessionId: 'session-1',
  };

  it('renders null when isOpen is false', () => {
    const { container } = render(<ContextPanel {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches context when opened', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        traces: [{ traceId: 'trace-12345678', status: 'completed', steps: [] }],
        memory: [{ content: 'Memory fact', timestamp: Date.now() }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ContextPanel {...defaultProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chat/context?sessionId=session-1');
    });

    expect(screen.getByText('trace-12')).toBeInTheDocument(); // Substring of traceId
  });

  it('switches between trace and memory tabs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        traces: [],
        memory: [{ content: 'Memory fact', timestamp: Date.now(), type: 'Fact' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ContextPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No live events detected')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('MEMORY_RESERVE'));

    expect(screen.getByText('Memory fact')).toBeInTheDocument();
    expect(screen.getByText('Fact')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<ContextPanel {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: '' })); // The X icon button
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
