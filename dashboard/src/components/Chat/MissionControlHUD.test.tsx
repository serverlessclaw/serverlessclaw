import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MissionControlHUD } from './MissionControlHUD';
import { TranslationsProvider } from '../Providers/TranslationsProvider';

// Mock Realtime Context
const mockRealtimeContext = {
  isConnected: true,
  error: null,
  userId: 'dashboard-user',
  subscribe: vi.fn(() => vi.fn()),
  sessions: [],
  pendingMessages: [],
  setPendingMessages: vi.fn(),
  fetchSessions: vi.fn(),
  isLive: true,
};

vi.mock('../Providers/RealtimeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Providers/RealtimeProvider')>();
  return {
    ...actual,
    useRealtimeContext: () => mockRealtimeContext,
    RealtimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Mock heavy child components
vi.mock('./ChatMessageList', () => ({
  ChatMessageList: () => <div data-testid="chat-message-list" />,
}));

vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('../DynamicComponents/StatusFlow', () => ({
  StatusFlow: () => <div data-testid="status-flow" />,
}));

vi.mock('../DynamicComponents/OperationCard', () => ({
  OperationCard: () => <div data-testid="operation-card" />,
}));

describe('MissionControlHUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly in standalone mode', async () => {
    render(
      <TranslationsProvider>
        <MissionControlHUD sessionId="test-session" />
      </TranslationsProvider>
    );

    expect(screen.getByText(/Mission_Control/i)).toBeInTheDocument();
  });

  it('handles initial activity simulation', async () => {
    render(
      <TranslationsProvider>
        <MissionControlHUD sessionId="test-session" />
      </TranslationsProvider>
    );

    // The component has a mock initial activity set in useEffect
    delete (window as unknown as { location: unknown }).location;
    (window as unknown as { location: unknown }).location = {
      href: 'http://localhost/',
    };

    // Since we're using a short timeout in the component, we'll wait
    const activity = await screen.findByText(/Mission initialized/i);
    expect(activity).toBeInTheDocument();
  });
});
