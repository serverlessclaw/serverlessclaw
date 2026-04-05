// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import SystemPulsePage from './page';

// Mock next/dynamic
vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockDynamicComponent() {
      return <div data-testid="mock-flow">Mock Flow</div>;
    };
  },
}));

// Mock UI components
vi.mock('@/components/ui/Typography', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="typography">{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Zap: () => <div data-testid="zap-icon" />,
}));

describe('SystemPulsePage', () => {
  it('renders the page title and description', () => {
    render(<SystemPulsePage />);
    expect(screen.getByText('System Pulse')).toBeInTheDocument();
    expect(screen.getByText(/Real-time infrastructure topology/i)).toBeInTheDocument();
  });

  it('renders the architecture map header', () => {
    render(<SystemPulsePage />);
    expect(screen.getByText(/Architecture Map/i)).toBeInTheDocument();
    expect(screen.getByTestId('zap-icon')).toBeInTheDocument();
  });

  it('renders the legend items', () => {
    render(<SystemPulsePage />);
    expect(screen.getByText('AGENT_NODE')).toBeInTheDocument();
    expect(screen.getByText('PRIMARY_BUS')).toBeInTheDocument();
    expect(screen.getByText('INFRA_NODE')).toBeInTheDocument();
  });

  it('renders the Flow component', () => {
    render(<SystemPulsePage />);
    expect(screen.getByTestId('mock-flow')).toBeInTheDocument();
  });
});
