// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ChatContent from './ChatContent';

// Mock sub-components
vi.mock('./ChatSidebar', () => ({
  ChatSidebar: () => <div data-testid="chat-sidebar">ChatSidebar</div>,
}));
vi.mock('./ChatHeader', () => ({
  ChatHeader: () => <div data-testid="chat-header">ChatHeader</div>,
}));
vi.mock('./ChatMessageList', () => ({
  ChatMessageList: () => <div data-testid="message-list">ChatMessageList</div>,
}));
vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input">ChatInput</div>,
}));
vi.mock('./MissionBriefing', () => ({
  MissionBriefing: () => <div data-testid="mission-briefing">MissionBriefing</div>,
}));
vi.mock('./MissionControlHUD', () => ({
  MissionControlHUD: () => <div data-testid="mission-hud">MissionControlHUD</div>,
}));

// Mock hooks
vi.mock('./useChatMessages', () => ({
  useChatMessages: () => ({
    messages: [],
    setMessages: vi.fn(),
    attachments: [],
    setAttachments: vi.fn(),
    loading: false,
    sendMessage: vi.fn(),
    handleFiles: vi.fn(),
    handleToolApproval: vi.fn(),
    handleToolRejection: vi.fn(),
    handleToolClarification: vi.fn(),
    handleTaskCancellation: vi.fn(),
    onNewChat: vi.fn(),
  }),
}));

vi.mock('@/components/Providers/TranslationsProvider', () => ({
  useTranslations: () => ({ t: (k: string) => k }),
  TranslationsProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/Providers/UICommandProvider', () => ({
  useUICommand: () => ({ setActiveModal: vi.fn(), activeModal: null }),
}));

vi.mock('@/components/Providers/TenantProvider', () => ({
  useTenant: () => ({ activeWorkspaceId: 'ws-1' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn() }),
}));

vi.mock('./useChatConnection', () => ({
  useChatConnection: () => ({
    isConnected: true,
    isRealtimeActive: true,
    lastJsonMessage: null,
    sessions: [],
    pendingMessages: [],
    setPendingMessages: vi.fn(),
    fetchSessions: vi.fn(),
    skipNextHistoryFetch: { current: false },
    seenMessageIds: { current: new Set() },
  }),
}));

describe('ChatContent Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders Mission Control layout by default (warRoomMode is on)', async () => {
    // Explicitly mock getItem to return 'true'
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('true');
    
    render(<ChatContent />);
    
    await waitFor(() => {
      expect(screen.getByTestId('mission-briefing')).toBeInTheDocument();
      expect(screen.getByTestId('mission-hud')).toBeInTheDocument();
    }, { timeout: 2000 });
    
    getItemSpy.mockRestore();
  });

  it('renders standard chat layout when warRoomMode is off', async () => {
    // Explicitly mock getItem to return 'false'
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('false');
    
    render(<ChatContent />);
    
    await waitFor(() => {
      expect(screen.getByTestId('chat-header')).toBeInTheDocument();
      expect(screen.getByTestId('message-list')).toBeInTheDocument();
    }, { timeout: 2000 });

    expect(screen.queryByTestId('mission-briefing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mission-hud')).not.toBeInTheDocument();
    
    getItemSpy.mockRestore();
  });

  it('persists sidebars even when activeSessionId is null if warRoomMode is on', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('true');
    
    render(<ChatContent />);
    
    // Persistence check: sidebars should be present during "New Chat" initialization
    await waitFor(() => {
      expect(screen.getByTestId('mission-briefing')).toBeInTheDocument();
      expect(screen.getByTestId('mission-hud')).toBeInTheDocument();
    }, { timeout: 2000 });
    
    getItemSpy.mockRestore();
  });
});
