/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useRef, useState, useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';
import { TranslationsProvider } from '@/components/Providers/TranslationsProvider';
import userEvent from '@testing-library/user-event';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

vi.mock('@claw/core/lib/constants', () => ({
  CONFIG_KEYS: {
    ACTIVE_LOCALE: 'active_locale',
  },
}));

const renderWithTranslations = (component: React.ReactElement) => {
  return render(<TranslationsProvider>{component}</TranslationsProvider>);
};

describe('ChatInput Component', () => {
  const defaultProps = {
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    onSend: vi.fn(),
    attachments: [],
    onRemoveAttachment: vi.fn(),
    fileInputRef: { current: null } as any,
    onFileSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the input textarea', () => {
    renderWithTranslations(<ChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Ask or command...')).toBeInTheDocument();
  });

  it('renders SEND button when not loading', () => {
    renderWithTranslations(<ChatInput {...defaultProps} />);
    expect(screen.getByText('SEND')).toBeInTheDocument();
  });

  it('renders EXECUTING button when loading', () => {
    renderWithTranslations(<ChatInput {...defaultProps} isLoading={true} />);
    expect(screen.getByText('EXECUTING...')).toBeInTheDocument();
  });

  it('disables send button when input is empty and no attachments', () => {
    renderWithTranslations(<ChatInput {...defaultProps} input="" />);
    const button = screen.getByText('SEND').closest('button');
    expect(button).toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('enables send button when input has text', () => {
    renderWithTranslations(<ChatInput {...defaultProps} input="hello" />);
    const button = screen.getByText('SEND').closest('button');
    expect(button).not.toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('enables send button when there are attachments', () => {
    renderWithTranslations(
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
    renderWithTranslations(
      <ChatInput
        {...defaultProps}
        attachments={[{ type: 'file', file: new File([''], 'document.pdf'), preview: '' }]}
      />
    );
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });

  it('renders image attachment previews', () => {
    renderWithTranslations(
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
    renderWithTranslations(<ChatInput {...defaultProps} input="hello" isLoading={true} />);
    const button = screen.getByText('EXECUTING...').closest('button');
    expect(button).toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('calls onSend when clicking the send button', async () => {
    const onSend = vi.fn();
    renderWithTranslations(<ChatInput {...defaultProps} input="hello" onSend={onSend} />);
    const button = screen.getByText('SEND');
    await userEvent.click(button);
    expect(onSend).toHaveBeenCalled();
  });

  it('calls onSend when pressing Enter', async () => {
    const onSend = vi.fn();
    renderWithTranslations(<ChatInput {...defaultProps} input="hello" onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Ask or command...');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalled();
  });

  it('does NOT call onSend when pressing Shift+Enter', async () => {
    const onSend = vi.fn();
    renderWithTranslations(<ChatInput {...defaultProps} input="hello" onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Ask or command...');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('calls onRemoveAttachment when clicking X on preview', async () => {
    const onRemoveAttachment = vi.fn();
    renderWithTranslations(
      <ChatInput
        {...defaultProps}
        attachments={[{ type: 'file', file: new File([''], 'test.txt'), preview: '' }]}
        onRemoveAttachment={onRemoveAttachment}
      />
    );
    const xButton = screen.getByRole('button', { name: 'remove-attachment' });
    await userEvent.click(xButton);
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);
  });

  it('triggers file input click when clicking paperclip button', async () => {
    const TestWrapper = () => {
      const fileInputRef = useRef<HTMLInputElement>(null);
      const [clicked, setClicked] = useState(false);
      useEffect(() => {
        if (fileInputRef.current) {
          fileInputRef.current.click = () => setClicked(true);
        }
      }, []);
      return (
        <>
          <ChatInput {...defaultProps} fileInputRef={fileInputRef} />
          {clicked && <div>CLICKED</div>}
        </>
      );
    };
    renderWithTranslations(<TestWrapper />);
    const clipButton = screen.getByRole('button', { name: 'attach-file' });
    fireEvent.click(clipButton);
    fireEvent.click(clipButton);
    expect(screen.getByText('CLICKED')).toBeInTheDocument();
  });

  it('calls onFileSelect when file input changes', () => {
    const onFileSelect = vi.fn();
    renderWithTranslations(<ChatInput {...defaultProps} onFileSelect={onFileSelect} />);

    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File([''], 'test.png')] } });
    expect(onFileSelect).toHaveBeenCalled();
  });

  it('applies shaking animation when isShaking is true', () => {
    const { container } = renderWithTranslations(<ChatInput {...defaultProps} isShaking={true} />);
    expect(container.querySelector('.animate-shake')).toBeInTheDocument();
  });

  it('triggers local shake when trying to send empty input', async () => {
    renderWithTranslations(<ChatInput {...defaultProps} input="" attachments={[]} />);
    const sendButton = screen.getByText('SEND').closest('button');
    fireEvent.click(sendButton!);

    expect(screen.getByRole('textbox').closest('.animate-shake')).toBeDefined();
  });

  it('resizes textarea on input', () => {
    renderWithTranslations(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Ask or command...');

    // Mock scrollHeight
    Object.defineProperty(textarea, 'scrollHeight', { value: 100, configurable: true });

    fireEvent.input(textarea);
    expect(textarea.style.height).toBe('100px');
  });
});
