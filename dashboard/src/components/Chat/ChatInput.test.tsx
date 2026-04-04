// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatInput } from './ChatInput';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

describe('ChatInput Component', () => {
  const defaultProps = {
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    onSend: vi.fn(),
    attachments: [],
    onRemoveAttachment: vi.fn(),
    fileInputRef: { current: null },
    onFileSelect: vi.fn(),
  };

  it('renders the input textarea', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Execute command or query system...')).toBeInTheDocument();
  });

  it('renders SEND button when not loading', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByText('SEND')).toBeInTheDocument();
  });

  it('renders EXECUTING button when loading', () => {
    render(<ChatInput {...defaultProps} isLoading={true} />);
    expect(screen.getByText('EXECUTING...')).toBeInTheDocument();
  });

  it('disables send button when input is empty and no attachments', () => {
    render(<ChatInput {...defaultProps} input="" />);
    const button = screen.getByText('SEND').closest('button');
    expect(button).toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('enables send button when input has text', () => {
    render(<ChatInput {...defaultProps} input="hello" />);
    const button = screen.getByText('SEND').closest('button');
    expect(button).not.toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('enables send button when there are attachments', () => {
    render(
      <ChatInput
        {...defaultProps}
        input=""
        attachments={[{ type: 'file', file: new File([''], 'test.txt'), preview: '' }]}
      />
    );
    const button = screen.getByText('SEND').closest('button');
    expect(button).not.toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('renders file attachment previews', () => {
    render(
      <ChatInput
        {...defaultProps}
        attachments={[{ type: 'file', file: new File([''], 'document.pdf'), preview: '' }]}
      />
    );
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });

  it('renders image attachment previews', () => {
    render(
      <ChatInput
        {...defaultProps}
        attachments={[
          {
            type: 'image',
            file: new File([''], 'photo.jpg'),
            preview: 'data:image/png;base64,test',
          },
        ]}
      />
    );
    expect(screen.getByAltText('preview')).toBeInTheDocument();
  });

  it('disables send button when loading', () => {
    render(<ChatInput {...defaultProps} input="hello" isLoading={true} />);
    const button = screen.getByText('EXECUTING...').closest('button');
    expect(button).toHaveClass('opacity-50', 'cursor-not-allowed');
  });
});
