// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgentTuningHub from './AgentTuningHub';
import { TranslationsProvider } from '../Providers/TranslationsProvider';
import { toast } from 'sonner';

// Mock UI components that are too heavy for unit tests
vi.mock('../DynamicComponents/StatusFlow', () => ({
  StatusFlow: () => <div data-testid="status-flow" />,
}));

vi.mock('../Chat/ChatHistoryTimeline', () => ({
  ChatHistoryTimeline: () => <div data-testid="history-timeline" />,
}));

// Mock API calls
const mockAgents = [
  {
    id: 'agent-1',
    name: 'Research Agent',
    enabled: true,
    evolutionMode: 'AUTONOMOUS',
    trustScore: 85,
    systemPrompt: 'Test prompt',
  },
];

vi.mock('../../lib/api/agents', () => ({
  fetchAgents: vi.fn(async () => mockAgents),
  updateAgent: vi.fn(async () => ({ success: true })),
}));

// Mock Framer Motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    span: ({ children, ...props }: { children: React.ReactNode }) => (
      <span {...props}>{children}</span>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div style={{ width: '100%', height: '100%' }}>{children}</div>
  ),
  BarChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
    <div>
      {(data as { name: string }[])?.map((d) => (
        <div key={d.name}>{d.name}</div>
      ))}
      {children}
    </div>
  ),
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Cell: () => <div />,
}));

// Mock Sonner
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

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

const createMockResponse = (data: unknown) =>
  ({
    json: async () => data,
    ok: true,
    status: 200,
    headers: new Headers(),
  }) as unknown as Response;

describe('AgentTuningHub', () => {
  const defaultProps = {
    agentId: 'agent-1',
    lastTraceId: 'trace-123',
    errorDistribution: { 'ERROR#TIMEOUT': 5, 'ERROR#API': 2 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });
  });

  it('renders correctly and shows error distribution', async () => {
    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    expect(screen.getByText('Evolution sandbox')).toBeInTheDocument();
    expect(screen.getByText('TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
  });

  it('performs analysis successfully', async () => {
    const mockSuggestions = {
      rootCause: 'Rate limiting on API calls',
      suggestions: ['Increase retry interval', 'Add jitter'],
      improvedPromptSnippet: 'Ensure retries follow exponential backoff.',
      confidence: 0.95,
    };

    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ suggestions: mockSuggestions }));

    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    const detectButton = screen.getByText('Detect Cognitive Drift');
    fireEvent.click(detectButton);

    await screen.findByText(/Synthesizing Patterns/);

    await screen.findByText(/Rate limiting on API calls/);

    expect(screen.getByText('Confidence: 95%')).toBeInTheDocument();
    expect(screen.getByText('Increase retry interval')).toBeInTheDocument();
    expect(screen.getByText('Ensure retries follow exponential backoff.')).toBeInTheDocument();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Intelligence Hub: Tuning suggestions generated.'
    );
  });

  it('handles analysis failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('API error'));

    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    const detectButton = screen.getByText('Detect Cognitive Drift');
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to analyze failure markers.');
    });
  });

  it('handles analysis error from response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ error: 'Analysis failed' }));

    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    const detectButton = screen.getByText('Detect Cognitive Drift');
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to analyze failure markers.');
    });
  });

  it('warns if no traceId is provided for analysis', async () => {
    render(
      <TranslationsProvider>
        <AgentTuningHub agentId="agent-1" />
      </TranslationsProvider>
    );

    const detectButton = screen.getByText('Detect Cognitive Drift');
    fireEvent.click(detectButton);

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'No recent failures recorded for analysis.'
    );
  });

  it('copies snippet to clipboard', async () => {
    const mockSuggestions = {
      rootCause: 'Test cause',
      suggestions: ['Test suggestion'],
      improvedPromptSnippet: 'Test snippet',
      confidence: 0.9,
    };

    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ suggestions: mockSuggestions }));

    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    fireEvent.click(screen.getByText('Detect Cognitive Drift'));

    await screen.findByText('Test snippet');

    const copyButton = screen.getByTestId('copy-snippet-button');
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test snippet');
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Improvement snippet copied to clipboard.'
    );
  });

  it('dismisses suggestions', async () => {
    const mockSuggestions = {
      rootCause: 'Test cause',
      suggestions: ['Test suggestion'],
      improvedPromptSnippet: 'Test snippet',
      confidence: 0.9,
    };

    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ suggestions: mockSuggestions }));

    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    fireEvent.click(screen.getByText('Detect Cognitive Drift'));
    await screen.findByTestId('dismiss-suggestions-button');

    fireEvent.click(screen.getByTestId('dismiss-suggestions-button'));
    expect(screen.queryByText('Test snippet')).not.toBeInTheDocument();
    expect(screen.getByText('Detect Cognitive Drift')).toBeInTheDocument();
  });

  it('applies pattern and redirects', async () => {
    const mockSuggestions = {
      rootCause: 'Test cause',
      suggestions: ['Test suggestion'],
      improvedPromptSnippet: 'Test snippet',
      confidence: 0.9,
    };

    vi.mocked(fetch).mockResolvedValueOnce(createMockResponse({ suggestions: mockSuggestions }));

    // Mock window.location
    vi.stubGlobal('location', {
      ...window.location,
      href: '',
    });

    render(
      <TranslationsProvider>
        <AgentTuningHub {...defaultProps} />
      </TranslationsProvider>
    );

    fireEvent.click(screen.getByText('Detect Cognitive Drift'));
    await screen.findByText('Apply Pattern');

    fireEvent.click(screen.getByText('Apply Pattern'));

    expect(window.location.href).toContain('/playground?');
    expect(window.location.href).toContain('agentId=agent-1');
    expect(window.location.href).toContain('suggestedPrompt=Test+snippet');
    expect(window.location.href).toContain('replayTraceId=trace-123');

    vi.unstubAllGlobals();
  });
});
