// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatSidebar } from './ChatSidebar';
import { TranslationsProvider } from '@/components/Providers/TranslationsProvider';

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
    sessions: mockSessions as any,
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
});
