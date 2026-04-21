// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentTuningHub from './AgentTuningHub';

// Mock UI components
vi.mock('@/components/ui/Card', () => ({
  default: ({ children, className }: { children?: React.ReactNode; className?: string }) => <div data-testid="card" className={className}>{children}</div>,
}));

vi.mock('@/components/ui/Typography', () => ({
  default: ({ children, className, variant }: { children?: React.ReactNode; className?: string; variant?: string }) => <div data-testid="typography" data-variant={variant} className={className}>{children}</div>,
}));

vi.mock('@/components/ui/Button', () => ({
  default: ({ children, onClick, variant, icon }: { children?: React.ReactNode; onClick?: () => void; variant?: string; icon?: React.ReactNode }) => (
    <button data-testid="button" onClick={onClick} data-variant={variant}>{icon}{children}</button>
  ),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <div data-testid="alert-circle" />,
  AlertTriangle: () => <div data-testid="alert-triangle" />,
  ArrowRight: () => <div data-testid="arrow-right" />,
  CheckCircle: () => <div data-testid="check-circle" />,
  RefreshCw: () => <div data-testid="refresh-cw" />,
  FileCode: () => <div data-testid="file-code" />,
  Zap: () => <div data-testid="zap" />,
  BrainCircuit: () => <div data-testid="brain-circuit" />,
  Copy: () => <div data-testid="copy" />,
  Target: () => <div data-testid="target" />,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ data }: { data?: Array<{ name: string; value: number }> }) => (
    <div data-testid="bar-chart">
      {data?.map((d, i) => (
        <span key={i}>{d.name}</span>
      ))}
    </div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

describe('AgentTuningHub', () => {
  const defaultProps = {
    agentId: 'test-agent',
    lastTraceId: 'trace-123',
    errorDistribution: {
      'Logic Error': 5,
      'Timeout': 2,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it('renders title and agent ID', () => {
    render(<AgentTuningHub {...defaultProps} />);
    expect(screen.getByText('Evolution sandbox')).toBeInTheDocument();
  });

  it('displays error distribution metrics', () => {
    render(<AgentTuningHub {...defaultProps} />);
    expect(screen.getByText('Logic Error')).toBeInTheDocument();
    expect(screen.getByText('Timeout')).toBeInTheDocument();
  });

  it('triggers AI tuning on button click', async () => {
    // Mock global fetch
    const mockResponse = {
      suggestions: {
        analysis: 'Poor reasoning.',
        improvedPromptSnippet: 'Be more logical.',
      },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    render(<AgentTuningHub {...defaultProps} />);
    const tuneButton = screen.getByText('Detect Cognitive Drift');
    fireEvent.click(tuneButton);

    expect(tuneButton).toBeInTheDocument();
    // Verification of API call
    expect(global.fetch).toHaveBeenCalledWith('/api/agents/suggest-tuning', expect.any(Object));
  });

  it('shows empty state when no errors are present', () => {
    render(<AgentTuningHub agentId="clean-agent" />);
    expect(screen.getByText('No failure telemetry recorded.')).toBeInTheDocument();
  });
});

