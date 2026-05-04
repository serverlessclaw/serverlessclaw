// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card from './Card';

describe('Card Component', () => {
  it('renders children content', () => {
    render(<Card>Card Content</Card>);
    expect(screen.getByText('Card Content')).toBeInTheDocument();
  });

  it('applies glass variant by default', () => {
    render(<Card>Default</Card>);
    const card = screen.getByText('Default').closest('div');
    expect(card!.className).toContain('glass-card');
  });

  it('applies solid variant', () => {
    render(<Card variant="solid">Solid</Card>);
    const card = screen.getByText('Solid').closest('div');
    expect(card!.className).toContain('bg-card');
    expect(card!.className).toContain('border-border');
  });

  it('applies outline variant', () => {
    render(<Card variant="outline">Outline</Card>);
    const card = screen.getByText('Outline').closest('div');
    expect(card!.className).toContain('border-border');
  });

  it('applies md padding by default', () => {
    render(<Card>Default Padding</Card>);
    const card = screen.getByText('Default Padding').closest('div');
    expect(card!.className).toContain('p-6');
  });

  it('applies none padding', () => {
    render(<Card padding="none">No Padding</Card>);
    const card = screen.getByText('No Padding').closest('div');
    expect(card!.className).toContain('p-0');
  });

  it('applies sm padding', () => {
    render(<Card padding="sm">Small</Card>);
    const card = screen.getByText('Small').closest('div');
    expect(card!.className).toContain('p-4');
  });

  it('applies lg padding', () => {
    render(<Card padding="lg">Large</Card>);
    const card = screen.getByText('Large').closest('div');
    expect(card!.className).toContain('p-8');
  });

  it('applies custom className', () => {
    render(<Card className="my-custom">Custom</Card>);
    const card = screen.getByText('Custom').closest('div');
    expect(card!.className).toContain('my-custom');
  });

  it('renders complex children', () => {
    render(
      <Card>
        <h2>Title</h2>
        <p>Description</p>
      </Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });
});
