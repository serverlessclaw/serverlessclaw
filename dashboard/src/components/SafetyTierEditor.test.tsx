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
    currentTier: 'sandbox' as const,
    onTierChange: vi.fn(),
  };

  it('should render both tier options', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText('Autonomous')).toBeInTheDocument();
  });

  it('should display tier descriptions', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(
      screen.getByText('Isolated execution environment with strict boundaries.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Full operational authority with guardrails and audit trail.')
    ).toBeInTheDocument();
  });

  it('should show "Active Tier" badge for current tier', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="sandbox" />);

    const activeTierBadges = screen.getAllByText('Active Tier');
    expect(activeTierBadges).toHaveLength(1);
  });

  it('should display allowed actions for Sandbox tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Read-only file access')).toBeInTheDocument();
    expect(screen.getByText('Query database operations')).toBeInTheDocument();
    expect(screen.getByText('LLM reasoning & planning')).toBeInTheDocument();
    expect(screen.getByText('MCP tool read operations')).toBeInTheDocument();
  });

  it('display blocked actions for Sandbox tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Code modifications')).toBeInTheDocument();
    expect(screen.getByText('Production deployments')).toBeInTheDocument();
    // Shell command execution appears in both tiers, so use getAllByText
    const shellCommandElements = screen.getAllByText('Shell command execution');
    expect(shellCommandElements.length).toBeGreaterThan(0);
    expect(screen.getByText('MCP write operations')).toBeInTheDocument();
    expect(screen.getByText('Destructive file operations')).toBeInTheDocument();
  });

  it('should display allowed actions for Autonomous tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Code modifications & PRs')).toBeInTheDocument();
    expect(screen.getByText('Staging deployments')).toBeInTheDocument();
    // Shell command execution appears in both tiers, so use getAllByText
    const shellCommandElements = screen.getAllByText('Shell command execution');
    expect(shellCommandElements.length).toBeGreaterThan(0);
    expect(screen.getByText('MCP full access')).toBeInTheDocument();
    expect(screen.getByText('File create/modify/delete')).toBeInTheDocument();
    expect(screen.getByText('Database read/write')).toBeInTheDocument();
  });

  it('should display blocked actions for Autonomous tier', () => {
    render(<SafetyTierEditor {...defaultProps} />);

    expect(screen.getByText('Production deployments (requires approval)')).toBeInTheDocument();
    expect(screen.getByText('Cross-account resource access')).toBeInTheDocument();
  });

  it('should call onTierChange when clicking a tier card', () => {
    const onTierChange = vi.fn();
    render(<SafetyTierEditor {...defaultProps} onTierChange={onTierChange} />);

    const cards = screen.getAllByTestId('card');
    fireEvent.click(cards[1]); // Click Autonomous tier

    expect(onTierChange).toHaveBeenCalledWith('autonomous');
  });

  it('should call onTierChange when clicking Sandbox tier', () => {
    const onTierChange = vi.fn();
    render(
      <SafetyTierEditor {...defaultProps} currentTier="autonomous" onTierChange={onTierChange} />
    );

    const cards = screen.getAllByTestId('card');
    fireEvent.click(cards[0]); // Click Sandbox tier

    expect(onTierChange).toHaveBeenCalledWith('sandbox');
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
    render(<SafetyTierEditor {...defaultProps} currentTier="sandbox" />);

    const shieldCheckIcons = screen.getAllByTestId('shield-check');
    expect(shieldCheckIcons).toHaveLength(1);
  });

  it('should render shield-alert icon for inactive tier', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="sandbox" />);

    const shieldAlertIcons = screen.getAllByTestId('shield-alert');
    expect(shieldAlertIcons).toHaveLength(1);
  });

  it('should apply correct styling for active tier card', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="sandbox" />);

    const cards = screen.getAllByTestId('card');
    const sandboxCard = cards[0];

    expect(sandboxCard).toHaveClass('border-cyber-blue/40');
    expect(sandboxCard).toHaveClass('shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-blue)_8%,transparent)]');
  });

  it('should apply correct styling for inactive tier card', () => {
    render(<SafetyTierEditor {...defaultProps} currentTier="sandbox" />);

    const cards = screen.getAllByTestId('card');
    const autonomousCard = cards[1];

    expect(autonomousCard).toHaveClass('border-border');
    expect(autonomousCard).toHaveClass('hover:border-foreground/10');
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
