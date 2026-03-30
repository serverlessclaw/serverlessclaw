// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CognitiveHealthCard from './CognitiveHealthCard';

// Mock the UI components
vi.mock('@/components/ui/Card', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}));

vi.mock('@/components/ui/Typography', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="typography" className={className}>{children}</div>
  ),
}));

vi.mock('@/components/ui/Badge', () => ({
  default: ({ children, className, variant }: { children: React.ReactNode; className?: string; variant?: string }) => (
    <span data-testid="badge" data-variant={variant} className={className}>{children}</span>
  ),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <div data-testid="alert-triangle" />,
}));

describe('CognitiveHealthCard', () => {
  const defaultProps = {
    agentId: 'test-agent',
    score: 85,
    taskCompletionRate: 0.95,
    reasoningCoherence: 8.5,
    errorRate: 0.02,
    memoryFragmentation: 0.15,
    anomalies: [],
  };

  it('should render agent ID', () => {
    render(<CognitiveHealthCard {...defaultProps} />);
    expect(screen.getByText('test-agent')).toBeInTheDocument();
  });

  it('should display score in gauge', () => {
    render(<CognitiveHealthCard {...defaultProps} />);
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('should display metrics correctly', () => {
    render(<CognitiveHealthCard {...defaultProps} />);
    
    expect(screen.getByText('Task Completion')).toBeInTheDocument();
    expect(screen.getByText('95.0%')).toBeInTheDocument();
    
    expect(screen.getByText('Reasoning Coherence')).toBeInTheDocument();
    expect(screen.getByText('8.5/10')).toBeInTheDocument();
    
    expect(screen.getByText('Error Rate')).toBeInTheDocument();
    expect(screen.getByText('2.0%')).toBeInTheDocument();
    
    expect(screen.getByText('Memory Fragmentation')).toBeInTheDocument();
    expect(screen.getByText('15.0%')).toBeInTheDocument();
  });

  it('should not show anomalies section when anomalies array is empty', () => {
    render(<CognitiveHealthCard {...defaultProps} anomalies={[]} />);
    expect(screen.queryByText('Anomalies')).not.toBeInTheDocument();
  });

  it('should show anomalies section when anomalies exist', () => {
    const anomalies = [
      { type: 'PERFORMANCE', severity: 'HIGH', message: 'High latency detected' },
      { type: 'MEMORY', severity: 'MEDIUM', message: 'Memory leak suspected' },
    ];
    
    render(<CognitiveHealthCard {...defaultProps} anomalies={anomalies} />);
    
    expect(screen.getByText('Anomalies')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('High latency detected')).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('Memory leak suspected')).toBeInTheDocument();
  });

  it('should show anomaly count badge when anomalies exist', () => {
    const anomalies = [
      { type: 'PERFORMANCE', severity: 'HIGH', message: 'Test anomaly' },
    ];
    
    render(<CognitiveHealthCard {...defaultProps} anomalies={anomalies} />);
    
    expect(screen.getByTestId('alert-triangle')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('should apply correct gauge color for high score (>=80)', () => {
    render(<CognitiveHealthCard {...defaultProps} score={85} />);
    const scoreElement = screen.getByText('85');
    expect(scoreElement).toHaveStyle({ color: '#00ffa3' });
  });

  it('should apply correct gauge color for medium score (60-79)', () => {
    render(<CognitiveHealthCard {...defaultProps} score={70} />);
    const scoreElement = screen.getByText('70');
    expect(scoreElement).toHaveStyle({ color: '#f59e0b' });
  });

  it('should apply correct gauge color for low score (<60)', () => {
    render(<CognitiveHealthCard {...defaultProps} score={45} />);
    const scoreElement = screen.getByText('45');
    expect(scoreElement).toHaveStyle({ color: '#ef4444' });
  });

  it('should clamp score to 0-100 range', () => {
    render(<CognitiveHealthCard {...defaultProps} score={150} />);
    expect(screen.getByText('100')).toBeInTheDocument();
    
    render(<CognitiveHealthCard {...defaultProps} score={-10} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should apply correct badge variant for CRITICAL severity', () => {
    const anomalies = [{ type: 'TEST', severity: 'CRITICAL', message: 'Critical issue' }];
    render(<CognitiveHealthCard {...defaultProps} anomalies={anomalies} />);
    
    const badges = screen.getAllByTestId('badge');
    // First badge is the anomaly count badge, second is the severity badge
    expect(badges[1]).toHaveAttribute('data-variant', 'danger');
  });

  it('should apply correct badge variant for HIGH severity', () => {
    const anomalies = [{ type: 'TEST', severity: 'HIGH', message: 'High issue' }];
    render(<CognitiveHealthCard {...defaultProps} anomalies={anomalies} />);
    
    const badges = screen.getAllByTestId('badge');
    expect(badges[1]).toHaveAttribute('data-variant', 'warning');
  });

  it('should apply correct badge variant for MEDIUM severity', () => {
    const anomalies = [{ type: 'TEST', severity: 'MEDIUM', message: 'Medium issue' }];
    render(<CognitiveHealthCard {...defaultProps} anomalies={anomalies} />);
    
    const badges = screen.getAllByTestId('badge');
    expect(badges[1]).toHaveAttribute('data-variant', 'audit');
  });

  it('should apply correct badge variant for LOW severity', () => {
    const anomalies = [{ type: 'TEST', severity: 'LOW', message: 'Low issue' }];
    render(<CognitiveHealthCard {...defaultProps} anomalies={anomalies} />);
    
    const badges = screen.getAllByTestId('badge');
    expect(badges[1]).toHaveAttribute('data-variant', 'outline');
  });

  it('should render SVG gauge with correct structure', () => {
    const { container } = render(<CognitiveHealthCard {...defaultProps} />);
    
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '100');
    expect(svg).toHaveAttribute('height', '100');
    
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2); // Background circle + progress circle
  });
});