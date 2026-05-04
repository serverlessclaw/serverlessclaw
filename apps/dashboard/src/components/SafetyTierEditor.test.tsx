// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SafetyTierEditor from './SafetyTierEditor';

// Mock the UI components
vi.mock('@/components/ui/Card', () => ({
  default: ({
    children,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <div data-testid="card" className={className} onClick={onClick}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/Typography', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="typography" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  ShieldCheck: () => <div data-testid="shield-check" />,
  ShieldAlert: () => <div data-testid="shield-alert" />,
  Check: () => <div data-testid="check-icon" />,
  X: () => <div data-testid="x-icon" />,
}));

describe('SafetyTierEditor', () => {
  const defaultProps = {
    currentTier: 'local' as const,
    onTierChange: vi.fn(),
  };

  it('should render both tier options', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
  });

  it('should display tier descriptions', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(
      screen.getByText('Local development environment, full access for testing.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Production environment, strict safety and approval gates.')
    ).toBeInTheDocument();
  });

  it('should show "Active Tier" badge for current tier', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="local" />);

    const activeTierBadges = screen.getAllByText('Active Tier');
    expect(activeTierBadges).toHaveLength(1);
  });

  it('should display allowed actions for Local tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Local deployments')).toBeInTheDocument();
    expect(screen.getByText('Shell command execution')).toBeInTheDocument();
    expect(screen.getByText('MCP full access')).toBeInTheDocument();
    expect(screen.getByText('File operations')).toBeInTheDocument();
    expect(screen.getByText('Database read/write')).toBeInTheDocument();
  });

  it('should display allowed actions for Production tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('LLM reasoning & planning')).toBeInTheDocument();
    expect(screen.getByText('MCP read operations')).toBeInTheDocument();
    expect(screen.getByText('Database read access')).toBeInTheDocument();
  });

  it('should display blocked actions for Production tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Direct deployments (requires approval)')).toBeInTheDocument();
    expect(screen.getByText('Destructive database operations')).toBeInTheDocument();
  });

  it('should call onTierChange when clicking a tier card', () => {
    const onTierChange = vi.fn();
    render(<SafetyTierEditor {...defaultProps} onTierChange={onTierChange} />);

    const cards = screen.getAllByTestId('card');
    fireEvent.click(cards[1]); // Click Production tier

    expect(onTierChange).toHaveBeenCalledWith('prod');
  });

  it('should call onTierChange when clicking Local tier', () => {
    const onTierChange = vi.fn();
    render(<SafetyTierEditor {...defaultProps} currentTier="prod" onTierChange={onTierChange} />);

    const cards = screen.getAllByTestId('card');
    fireEvent.click(cards[0]); // Click Local tier

    expect(onTierChange).toHaveBeenCalledWith('local');
  });

  it('should render check icons for allowed actions', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    const checkIcons = screen.getAllByTestId('check-icon');
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  it('should render x icons for blocked actions', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    const xIcons = screen.getAllByTestId('x-icon');
    expect(xIcons.length).toBeGreaterThan(0);
  });

  it('should render shield-check icon for active tier', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="local" />);

    const shieldCheckIcons = screen.getAllByTestId('shield-check');
    expect(shieldCheckIcons).toHaveLength(1);
  });

  it('should render shield-alert icon for inactive tier', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="local" />);

    const shieldAlertIcons = screen.getAllByTestId('shield-alert');
    expect(shieldAlertIcons).toHaveLength(1);
  });

  it('should apply correct styling for active tier card', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="local" />);

    const cards = screen.getAllByTestId('card');
    const localCard = cards[0];

    expect(localCard).toHaveClass('border-cyber-blue/40');
    expect(localCard).toHaveClass(
      'shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-blue)_8%,transparent)]'
    );
  });

  it('should apply correct styling for inactive tier card', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="local" />);

    const cards = screen.getAllByTestId('card');
    const prodCard = cards[1];

    expect(prodCard).toHaveClass('border-border');
    expect(prodCard).toHaveClass('hover:border-foreground/10');
  });

  it('should have correct grid layout', () => {
    const { container } = render(<SafetyTierEditor {...defaultProps} />);

    const gridContainer = container.firstChild;
    expect(gridContainer).toHaveClass('grid');
    expect(gridContainer).toHaveClass('grid-cols-1');
    expect(gridContainer).toHaveClass('md:grid-cols-2');
    expect(gridContainer).toHaveClass('gap-6');
  });
});
