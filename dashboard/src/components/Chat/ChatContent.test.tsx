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
  TranslationsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

// Create a functional localStorage mock for this test suite
const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
    get length() {
      return Object.keys(store).length;
    },
  };
};

const mockStorage = createLocalStorageMock();
vi.stubGlobal('localStorage', mockStorage);

describe('ChatContent Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.clear();
  });

  it('renders Mission Control layout by default (warRoomMode is on)', async () => {
    // Set to true explicitly
    mockStorage.setItem('claw_war_room_mode', 'true');

    render(<ChatContent />);

    await waitFor(
      () => {
        expect(screen.getByTestId('mission-briefing')).toBeInTheDocument();
        expect(screen.getByTestId('mission-hud')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('renders standard chat layout when warRoomMode is off', async () => {
    // Set to false explicitly
    mockStorage.setItem('claw_war_room_mode', 'false');

    render(<ChatContent />);

    await waitFor(
      () => {
        expect(screen.getByTestId('chat-header')).toBeInTheDocument();
        expect(screen.getByTestId('message-list')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    expect(screen.queryByTestId('mission-briefing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mission-hud')).not.toBeInTheDocument();
  });

  it('persists sidebars even when activeSessionId is null if warRoomMode is on', async () => {
    mockStorage.setItem('claw_war_room_mode', 'true');

    render(<ChatContent />);

    // Persistence check: sidebars should be present during "New Chat" initialization
    await waitFor(
      () => {
        expect(screen.getByTestId('mission-briefing')).toBeInTheDocument();
        expect(screen.getByTestId('mission-hud')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });
});
