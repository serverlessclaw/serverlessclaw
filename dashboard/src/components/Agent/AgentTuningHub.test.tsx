// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgentTuningHub from './AgentTuningHub';
import { toast } from 'sonner';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: (
    { children }: any /* eslint-disable-line @typescript-eslint/no-explicit-any */
  ) => <div>{children}</div>,
  BarChart: ({ children }: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => (
    <div>{children}</div>
  ),
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Cell: () => <div />,
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <div data-testid="icon-alert" />,
  RefreshCw: () => <div data-testid="icon-refresh" />,
  ArrowRight: () => <div data-testid="icon-arrow" />,
  CheckCircle: () => <div data-testid="icon-check" />,
  Zap: () => <div data-testid="icon-zap" />,
  Target: () => <div data-testid="icon-target" />,
  FileCode: () => <div data-testid="icon-filecode" />,
  Copy: () => <div data-testid="icon-copy" />,
  Loader2: () => <div data-testid="icon-loader" />,
}));

describe('AgentTuningHub', () => {
  const defaultProps = {
    agentId: 'agent-1',
    lastTraceId: 'trace-1',
    errorDistribution: { 'ERROR#Timeout': 5, 'ERROR#Syntax': 2 },
  };

  it('renders error distribution chart', () => {
    render(<AgentTuningHub {...defaultProps} />);
    expect(screen.getByText('Failure Markers')).toBeInTheDocument();
  });

  it('shows no telemetry message when distribution is empty', () => {
    render(<AgentTuningHub agentId="agent-1" errorDistribution={{}} />);
    expect(screen.getByText('No failure telemetry recorded.')).toBeInTheDocument();
  });

  it('performs analysis and displays suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: {
          rootCause: 'Complex nested logic',
          suggestions: ['Flatten the structure', 'Add more context'],
          improvedPromptSnippet: 'New prompt content',
          confidence: 0.95,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTuningHub {...defaultProps} />);

    fireEvent.click(screen.getByText('Detect Cognitive Drift'));

    await waitFor(() => {
      expect(screen.getByText('Analysis Result')).toBeInTheDocument();
    });

    expect(screen.getByText(/Complex nested logic/i)).toBeInTheDocument();
    expect(screen.getByText('Confidence: 95%')).toBeInTheDocument();
    expect(screen.getByText('Flatten the structure')).toBeInTheDocument();
  });

  it('copies snippet to clipboard', async () => {
    // Mock suggestions to show the copy button
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: {
          rootCause: 'Test',
          suggestions: [],
          improvedPromptSnippet: 'Copied content',
          confidence: 1,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTuningHub {...defaultProps} />);
    fireEvent.click(screen.getByText('Detect Cognitive Drift'));

    await waitFor(() => screen.getByText('Analysis Result'));

    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    fireEvent.click(screen.getByTestId('icon-copy').closest('button')!);
    expect(writeText).toHaveBeenCalledWith('Copied content');
    expect(toast.success).toHaveBeenCalledWith('Improvement snippet copied to clipboard.');
  });

  it('redirects to playground when Apply Pattern is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: {
          rootCause: 'Test',
          suggestions: [],
          improvedPromptSnippet: 'New Prompt',
          confidence: 1,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Mock window.location
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, href: '' } as any;

    render(<AgentTuningHub {...defaultProps} />);
    fireEvent.click(screen.getByText('Detect Cognitive Drift'));

    await waitFor(() => screen.getByText('Analysis Result'));

    fireEvent.click(screen.getByText('Apply Pattern'));
    expect(window.location.href).toContain('/playground?agentId=agent-1');
    expect(window.location.href).toContain('suggestedPrompt=New+Prompt');

    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('dismisses suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: {
          rootCause: 'Test',
          suggestions: [],
          improvedPromptSnippet: 'Snippet',
          confidence: 1,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTuningHub {...defaultProps} />);
    fireEvent.click(screen.getByText('Detect Cognitive Drift'));

    await waitFor(() => screen.getByText('Analysis Result'));

    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('Analysis Result')).not.toBeInTheDocument();
  });
});
