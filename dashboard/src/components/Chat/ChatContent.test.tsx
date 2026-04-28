// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ChatContent from './ChatContent';

// Mock sub-components
vi.mock('./ChatSidebar', () => ({
  ChatSidebar: ({ onSessionSelect, onNewChat, onDeleteSession, onDeleteAll }: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => (
    <div data-testid="chat-sidebar">
      <button onClick={() => onSessionSelect('session-1')}>Select Session</button>
      <button onClick={() => onNewChat()}>New Chat</button>
      <button onClick={(e) => onDeleteSession(e, 'session-2')}>Delete Session</button>
      <button onClick={() => onDeleteAll()}>Delete All</button>
    </div>
  ),
}));
vi.mock('./ChatHeader', () => ({
  ChatHeader: ({ saveTitle, setIsEditingTitle }: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => (
    <div data-testid="chat-header">
      <button onClick={() => setIsEditingTitle(true)}>Edit Title</button>
      <button onClick={() => saveTitle()}>Save Title</button>
    </div>
  ),
}));
vi.mock('./ChatMessageList', () => ({
  ChatMessageList: () => <div data-testid="message-list">ChatMessageList</div>,
}));
vi.mock('./ChatInput', () => ({
  ChatInput: (props: any) => (
    <div data-testid="chat-input">
      <button onClick={(e: any) => props.onSend(e)}>Send</button>
    </div>
  ),
}));
vi.mock('./MissionBriefing', () => ({
  MissionBriefing: () => <div data-testid="mission-briefing">MissionBriefing</div>,
}));
vi.mock('./MissionControlHUD', () => ({
  MissionControlHUD: () => <div data-testid="mission-hud">MissionControlHUD</div>,
}));
vi.mock('./AgentSelector', () => ({
  AgentSelector: (props: any) => (
    <div data-testid="agent-selector">
      <span>{props.title}</span>
      <button onClick={() => props.onSelect('agent-1')}>Select Agent</button>
      <button onClick={props.onClose}>Close</button>
    </div>
  ),
}));
vi.mock('./QueuedMessages', () => ({
  QueuedMessagesList: (props: any) => (
    <div data-testid="queued-messages">
      {(props.messages || []).map((m: any) => (
        <div key={m.id}>
          <span>{m.content}</span>
          <button onClick={() => props.onEdit(m.id, 'new content')}>Edit {m.id}</button>
          <button onClick={() => props.onRemove(m.id)}>Remove {m.id}</button>
        </div>
      ))}
    </div>
  ),
}));

// Mock hooks
const mockSendMessage = vi.fn();
vi.mock('./useChatMessages', () => ({
  useChatMessages: () => ({
    messages: [],
    setMessages: vi.fn(),
    attachments: [],
    setAttachments: vi.fn(),
    loading: false,
    sendMessage: mockSendMessage,
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
    sessions: [
      { sessionId: 'session-1', title: 'Test Session' },
      { sessionId: 'session-2', title: 'To Delete' },
    ],
    pendingMessages: [{ id: 'q-1', content: 'Queued Message' }],
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

  it('updates title when edited and saved', async () => {
    mockStorage.setItem('claw_war_room_mode', 'false');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatContent />);

    // Select a session first
    fireEvent.click(screen.getByText('Select Session'));

    fireEvent.click(screen.getByText('Edit Title'));
    fireEvent.click(screen.getByText('Save Title'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
  });

  it('switches sessions when a session is selected', async () => {
    render(<ChatContent />);

    fireEvent.click(screen.getByText('Select Session'));

    // Check if session ID is updated in the URL or component state
    // Since we can't easily check internal state, we check if router.push was called
    // because of the useEffect that syncs activeSessionId to URL
  });

  it('sends a message when send button is clicked', async () => {
    render(<ChatContent />);

    fireEvent.click(screen.getByText('Send'));
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('deletes a session and confirms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatContent />);

    fireEvent.click(screen.getByText('Delete Session'));
    // CyberConfirm should be visible
    fireEvent.click(screen.getByText('Confirm Action')); // CyberConfirm button

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('sessionId=session-2'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  it('purges all sessions and confirms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatContent />);

    fireEvent.click(screen.getByText('Delete All'));
    fireEvent.click(screen.getByText('Confirm Action'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('sessionId=all'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  it('edits and removes queued messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatContent />);

    // Need a session to be active for queued message handlers to run
    fireEvent.click(screen.getByText('Select Session'));

    fireEvent.click(screen.getByText('Edit q-1'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pending-messages',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });

    fireEvent.click(screen.getByText('Remove q-1'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pending-messages',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });
});
