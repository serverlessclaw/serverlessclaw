// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueuedMessageItem, QueuedMessagesList } from './QueuedMessages';

vi.mock('@claw/core/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('QueuedMessages', () => {
  const mockMessage = {
    id: 'msg-1',
    content: 'Test message',
    timestamp: Date.now(),
    sessionId: 'session-1',
    role: 'user' as const,
  };

  const mockOnEdit = vi.fn();
  const mockOnRemove = vi.fn();

  describe('QueuedMessageItem', () => {
    it('renders message content and timestamp', () => {
      render(
        <QueuedMessageItem message={mockMessage} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      expect(screen.getByText('Test message')).toBeInTheDocument();
      expect(screen.getByText('Queued')).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', () => {
      render(
        <QueuedMessageItem message={mockMessage} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      const editButton = screen.getByTitle('Edit message');
      fireEvent.click(editButton);

      expect(screen.getByRole('textbox')).toHaveValue('Test message');
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls onEdit when save button is clicked in edit mode', async () => {
      mockOnEdit.mockResolvedValueOnce(undefined);
      render(
        <QueuedMessageItem message={mockMessage} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      fireEvent.click(screen.getByTitle('Edit message'));
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Updated message' } });

      const saveButton = screen.getByRole('button', { name: '' }); // The Check icon button
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnEdit).toHaveBeenCalledWith('msg-1', 'Updated message');
      });
    });

    it('cancels edit mode and resets content when cancel is clicked', () => {
      render(
        <QueuedMessageItem message={mockMessage} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      fireEvent.click(screen.getByTitle('Edit message'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText('Test message')).toBeInTheDocument();
    });

    it('calls onRemove when remove button is clicked', async () => {
      mockOnRemove.mockResolvedValueOnce(undefined);
      render(
        <QueuedMessageItem message={mockMessage} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      fireEvent.click(screen.getByTitle('Remove message'));

      await waitFor(() => {
        expect(mockOnRemove).toHaveBeenCalledWith('msg-1');
      });
    });
  });

  describe('QueuedMessagesList', () => {
    it('returns null when messages array is empty', () => {
      const { container } = render(
        <QueuedMessagesList messages={[]} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders a list of messages when provided', () => {
      const messages = [
        { ...mockMessage, id: '1', content: 'Msg 1' },
        { ...mockMessage, id: '2', content: 'Msg 2' },
      ];

      render(
        <QueuedMessagesList messages={messages} onEdit={mockOnEdit} onRemove={mockOnRemove} />
      );

      expect(screen.getByText('2 queued messages (waiting for current task)')).toBeInTheDocument();
      expect(screen.getByText('Msg 1')).toBeInTheDocument();
      expect(screen.getByText('Msg 2')).toBeInTheDocument();
    });
  });
});
