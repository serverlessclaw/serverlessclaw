// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatSidebar } from './ChatSidebar';
import type { ConversationMeta } from '@claw/core/lib/types/memory';

// Mock translations
const mockT = vi.fn((key) => key);
vi.mock('@/components/Providers/TranslationsProvider', () => ({
  useTranslations: () => ({
    t: mockT,
    locale: 'en',
    setLocale: vi.fn(),
  }),
  TranslationsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('ChatSidebar Component', () => {
  const mockSessions = [
    {
      sessionId: '1',
      title: 'Session 1',
      lastMessage: 'Hello',
      updatedAt: Date.now(),
      isPinned: false,
    },
    {
      sessionId: '2',
      title: 'Pinned Session',
      lastMessage: 'World',
      updatedAt: Date.now(),
      isPinned: true,
    },
  ];

  const defaultProps = {
    sessions: mockSessions as ConversationMeta[],
    activeSessionId: '1',
    onSessionSelect: vi.fn(),
    onNewChat: vi.fn(),
    onDeleteSession: vi.fn(),
    onDeleteAll: vi.fn(),
    onTogglePin: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
  };

  it('renders session titles correctly', () => {
    render(<ChatSidebar {...defaultProps} />);
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    expect(screen.getByText('Pinned Session')).toBeInTheDocument();
  });

  it('filters sessions based on search query', () => {
    const props = { ...defaultProps, searchQuery: 'Pinned' };
    render(<ChatSidebar {...props} />);
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument();
    expect(screen.getByText('Pinned Session')).toBeInTheDocument();
  });

  it('calls onSessionSelect when a session is clicked', () => {
    render(<ChatSidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('Session 1'));
    expect(defaultProps.onSessionSelect).toHaveBeenCalledWith('1');
  });

  it('renders tooltips for action buttons on hover', async () => {
    render(<ChatSidebar {...defaultProps} />);

    // Hover over the first session to reveal buttons
    const sessionItem = screen.getByText('Session 1').closest('div[role="button"]');
    if (!sessionItem) throw new Error('Session item not found');

    fireEvent.mouseEnter(sessionItem);

    // The buttons have CyberTooltip wrappers
    // We can't easily "hover" to trigger the portal in this test environment without more setup,
    // but we can check if the tooltip components are present in the DOM structure if they were children.
    // However, since they use Portals, they'll only appear on mouseEnter of the BUTTON, not the session.

    const pinButton = sessionItem.querySelector('button'); // First button is Pin
    if (!pinButton) throw new Error('Pin button not found');

    fireEvent.mouseEnter(pinButton);

    // Check if tooltip content appears in portal (document.body)
    expect(screen.getByText('CHAT_SIDEBAR_PIN_SESSION')).toBeInTheDocument();
  });

  it('renders initials for untitled traces', () => {
    const props = {
      ...defaultProps,
      sessions: [
        { sessionId: '3', title: 'Untitled Trace', updatedAt: Date.now() } as ConversationMeta,
      ],
    };
    render(<ChatSidebar {...props} />);
    // Check initials in collapsed mode to trigger getInitials
    render(<ChatSidebar {...props} isCollapsed />);
    expect(screen.getByText('UT')).toBeInTheDocument();
  });

  it('generates initials correctly for different titles', () => {
    const props = {
      ...defaultProps,
      sessions: [
        { sessionId: '4', title: 'My New Session', updatedAt: Date.now() } as ConversationMeta,
        { sessionId: '5', title: 'Single', updatedAt: Date.now() } as ConversationMeta,
      ],
      isCollapsed: true,
    };
    render(<ChatSidebar {...props} />);
    expect(screen.getByText('MN')).toBeInTheDocument();
    expect(screen.getByText('SI')).toBeInTheDocument();
  });

  it('calls onDeleteSession when delete button is clicked', () => {
    render(<ChatSidebar {...defaultProps} />);
    const sessionItem = screen.getByText('Session 1').closest('div[role="button"]');
    const deleteButton = sessionItem?.querySelectorAll('button')[1];
    fireEvent.click(deleteButton!);
    expect(defaultProps.onDeleteSession).toHaveBeenCalled();
  });

  it('calls onDeleteAll when purge button is clicked', () => {
    render(<ChatSidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('CHAT_SIDEBAR_PURGE_ALL'));
    expect(defaultProps.onDeleteAll).toHaveBeenCalled();
  });

  it('calls onNewChat when new chat button is clicked', () => {
    render(<ChatSidebar {...defaultProps} />);
    fireEvent.click(screen.getByText('CHAT_SIDEBAR_NEW_CHAT'));
    expect(defaultProps.onNewChat).toHaveBeenCalled();
  });

  it('renders in collapsed mode and shows initials', () => {
    render(<ChatSidebar {...defaultProps} isCollapsed />);
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument();
    expect(screen.getByText('S1')).toBeInTheDocument(); // Initial for 'Session 1'
  });

  it('calls onTogglePin when pin button is clicked', () => {
    render(<ChatSidebar {...defaultProps} />);
    const sessionItem = screen.getByText('Session 1').closest('div[role="button"]');
    // The pin button is the first button in the actions div
    const pinButton = sessionItem?.querySelector('button');
    fireEvent.click(pinButton!);
    expect(defaultProps.onTogglePin).toHaveBeenCalledWith('1', true);
  });

  it('calls setSearchQuery when search input changes', () => {
    render(<ChatSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('CHAT_SIDEBAR_SEARCH');
    fireEvent.change(searchInput, { target: { value: 'test' } });
    expect(defaultProps.setSearchQuery).toHaveBeenCalledWith('test');
  });

  it('displays correct expiry text for old sessions', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const in24h = nowSeconds + (60 * 60 * 24 - 10);
    const in3d = nowSeconds + (60 * 60 * 24 * 3 + 10);

    const props = {
      ...defaultProps,
      sessions: [
        { sessionId: 'y', title: 'Tomorrow', expiresAt: in24h } as ConversationMeta,
        { sessionId: '3d', title: 'Old', expiresAt: in3d } as ConversationMeta,
      ],
    };
    render(<ChatSidebar {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/Expires in 23h|Expires soon/)).toBeInTheDocument();
      expect(screen.getByText('Expires in 3d')).toBeInTheDocument();
    });
  });
});
