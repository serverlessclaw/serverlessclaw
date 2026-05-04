// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessageList } from './ChatMessageList';
import { ChatMessage } from '@claw/hooks';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  User: () => <div data-testid="icon-user" />,
  Bot: () => <div data-testid="icon-bot" />,
  Terminal: () => <div data-testid="icon-terminal" />,
  File: () => <div data-testid="icon-file" />,
  Loader2: () => <div data-testid="icon-loader" />,
  MessageCircle: () => <div data-testid="icon-message-circle" />,
  Copy: () => <div data-testid="icon-copy" />,
  Check: () => <div data-testid="icon-check" />,
  Wrench: () => <div data-testid="icon-wrench" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
  Search: () => <div data-testid="icon-search" />,
  X: () => <div data-testid="icon-x" />,
}));

// Mock clipboard
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  configurable: true,
});

describe('ChatMessageList', () => {
  const mockMessages: ChatMessage[] = [
    {
      role: 'user',
      content: 'Hello, world!',
      createdAt: Date.now(),
    },
    {
      role: 'assistant',
      content: 'Hi there! I am your assistant.',
      agentName: 'ClawAgent',
      thought: 'Thinking process...',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      tool_calls: [
        {
          id: 'tc-1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city": "Tokyo"}' },
        },
      ],
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    },
  ];

  const defaultProps = {
    messages: mockMessages,
    isLoading: false,
    scrollRef: { current: null } as unknown as React.RefObject<HTMLDivElement>,
    onOptionClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a list of messages', () => {
    render(<ChatMessageList {...defaultProps} />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
    expect(screen.getByText('Hi there! I am your assistant.')).toBeInTheDocument();
    expect(screen.getByText('ClawAgent')).toBeInTheDocument();
  });

  it('shows thinking process when available', () => {
    render(<ChatMessageList {...defaultProps} />);
    expect(screen.getByText('Thinking process...')).toBeInTheDocument();
  });

  it('expands and collapses tool calls', () => {
    render(<ChatMessageList {...defaultProps} />);
    const toolCallButton = screen.getByText(/1 tool call/i);

    // Initial state: tool name should be visible but arguments might not be
    expect(screen.getByText('get_weather')).toBeInTheDocument();

    // Expand
    fireEvent.click(toolCallButton);
    expect(screen.getByText(/"city": "Tokyo"/i)).toBeInTheDocument();

    // Collapse
    fireEvent.click(toolCallButton);
    expect(screen.queryByText(/"city": "Tokyo"/i)).not.toBeInTheDocument();
  });

  it('handles option clicks with comments', () => {
    render(<ChatMessageList {...defaultProps} />);
    const commentInput = screen.getByPlaceholderText(/Add an optional comment/i);
    fireEvent.change(commentInput, { target: { value: 'My comment' } });

    fireEvent.click(screen.getByText('Yes'));
    expect(defaultProps.onOptionClick).toHaveBeenCalledWith('yes', 'My comment');
    expect(commentInput).toHaveValue(''); // Should clear after click
  });

  it('copies message content to clipboard', async () => {
    render(<ChatMessageList {...defaultProps} />);

    // Find the copy button for the first message
    // It's hidden by default, but we can still find it by title or icon test-id
    const copyButtons = screen.getAllByTitle('Copy message');
    fireEvent.click(copyButtons[0]);

    expect(mockClipboard.writeText).toHaveBeenCalledWith('Hello, world!');
  });

  it('filters messages based on search query', () => {
    render(<ChatMessageList {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText(/Search messages/i);

    fireEvent.change(searchInput, { target: { value: 'assistant' } });

    expect(screen.queryByText('Hello, world!')).not.toBeInTheDocument();
    expect(screen.getByText('Hi there! I am your assistant.')).toBeInTheDocument();
    expect(screen.getByText('1 Matches')).toBeInTheDocument();
  });

  it('renders various markdown elements', () => {
    const markdownMsg: ChatMessage = {
      role: 'assistant',
      content:
        '# Title1\n## Title2\n### Title3\n**Strong**\n[Link](https://google.com)\n* Item 1\n* Item 2\n`inline code`',
    };
    render(<ChatMessageList {...defaultProps} messages={[markdownMsg]} />);

    expect(screen.getByText('Title1')).toBeInTheDocument();
    expect(screen.getByText('Title2')).toBeInTheDocument();
    expect(screen.getByText('Title3')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Link')).toHaveAttribute('href', 'https://google.com');
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('inline code')).toBeInTheDocument();
  });

  it('renders code blocks and handles copying', async () => {
    const codeMsg: ChatMessage = {
      role: 'assistant',
      content: '```javascript\nconst x = 1;\n```',
    };
    render(<ChatMessageList {...defaultProps} messages={[codeMsg]} />);

    expect(screen.getByText('const x = 1;')).toBeInTheDocument();

    const copyBtn = screen.getByTitle('Copy to clipboard');
    fireEvent.click(copyBtn);
    expect(mockClipboard.writeText).toHaveBeenCalledWith('const x = 1;');
  });

  it('renders attachments (image and file)', () => {
    const attachmentMsg: ChatMessage = {
      role: 'user',
      content: '', // ChatMessage content is mandatory
      attachments: [
        { type: 'image', url: 'https://example.com/img.png', name: 'my-image.png' },
        { type: 'file', url: 'https://example.com/doc.pdf', name: 'my-doc.pdf' },
      ],
    };
    render(<ChatMessageList {...defaultProps} messages={[attachmentMsg]} />);

    expect(screen.getByAltText('my-image.png')).toBeInTheDocument();
    expect(screen.getByText('my-doc.pdf')).toBeInTheDocument();
  });

  it('renders loading state when list is empty', () => {
    render(<ChatMessageList {...defaultProps} messages={[]} isLoading={true} />);
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('shows thinking state for a message', () => {
    const thinkingMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      isThinking: true,
    };
    render(<ChatMessageList {...defaultProps} messages={[thinkingMessage]} />);
    expect(screen.getByText(/Analysing Signal/i)).toBeInTheDocument();
  });
});
