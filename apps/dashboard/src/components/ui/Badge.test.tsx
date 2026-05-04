// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge Component', () => {
  it('renders children text', () => {
    render(<Badge>ACTIVE</Badge>);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('applies primary variant by default', () => {
    render(<Badge>Test</Badge>);
    const badge = screen.getByText('Test');
    expect(badge.className).toContain('bg-cyber-green');
  });

  it('applies intel variant', () => {
    render(<Badge variant="intel">Intel</Badge>);
    const badge = screen.getByText('Intel');
    expect(badge.className).toContain('bg-cyber-blue');
  });

  it('applies danger variant', () => {
    render(<Badge variant="danger">Error</Badge>);
    const badge = screen.getByText('Error');
    expect(badge.className).toContain('bg-red-500');
  });

  it('applies warning variant', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('bg-orange-400');
  });

  it('applies outline variant', () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText('Outline');
    expect(badge.className).toContain('bg-transparent');
  });

  it('applies glow animation when glow is true', () => {
    render(<Badge glow>Glowing</Badge>);
    const badge = screen.getByText('Glowing');
    expect(badge.className).toContain('animate-pulse');
  });

  it('does not apply glow animation by default', () => {
    render(<Badge>Normal</Badge>);
    const badge = screen.getByText('Normal');
    expect(badge.className).not.toContain('animate-pulse');
  });

  it('applies custom className', () => {
    render(<Badge className="custom-class">Custom</Badge>);
    const badge = screen.getByText('Custom');
    expect(badge.className).toContain('custom-class');
  });
});
