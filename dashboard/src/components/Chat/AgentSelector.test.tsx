/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AgentSelector } from './AgentSelector';
import { TranslationsProvider } from '@/components/Providers/TranslationsProvider';

// Mock fetch
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

const renderWithTranslations = (component: React.ReactElement) => {
  return render(<TranslationsProvider>{component}</TranslationsProvider>);
};

describe('AgentSelector Component', () => {
  const defaultProps = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  const mockAgents = {
    agents: {
      superclaw: {
        id: 'superclaw',
        name: 'SuperClaw',
        description: 'Orchestrator',
        icon: 'Bot',
      },
      coder: {
        id: 'coder',
        name: 'Coder Agent',
        description: 'Builder',
        icon: 'Code',
      },
      logic_handler: {
        id: 'logic_handler',
        name: 'Logic',
        agentType: 'logic',
        description: 'Should be filtered',
      },
    },
  };

  let resolveFetch: (value: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => void;
  let fetchPromise: Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as any).mockReturnValue(fetchPromise);
  });

  it('renders loading state initially', () => {
    renderWithTranslations(<AgentSelector {...defaultProps} />);
    expect(screen.getByText(/Synchronizing Agent Registry/i)).toBeInTheDocument();
  });

  it('fetches agents and renders non-logic agents', async () => {
    renderWithTranslations(<AgentSelector {...defaultProps} />);

    resolveFetch({
      json: async () => mockAgents,
    });

    await waitFor(() => {
      expect(screen.getByText('SuperClaw')).toBeInTheDocument();
      expect(screen.getByText('Coder Agent')).toBeInTheDocument();
    });

    expect(screen.queryByText('Logic')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('filters out agents in excludeIds', async () => {
    renderWithTranslations(<AgentSelector {...defaultProps} excludeIds={['superclaw']} />);

    resolveFetch({
      json: async () => mockAgents,
    });

    await waitFor(() => {
      expect(screen.queryByText('SuperClaw')).not.toBeInTheDocument();
      expect(screen.getByText('Coder Agent')).toBeInTheDocument();
    });
  });

  it('does not re-fetch if excludeIds reference is stable', async () => {
    const { rerender } = renderWithTranslations(<AgentSelector {...defaultProps} />);

    resolveFetch({
      json: async () => mockAgents,
    });

    await waitFor(() => {
      expect(screen.getByText('SuperClaw')).toBeInTheDocument();
    });

    // Rerender with same stable props (including default EMPTY_ARRAY for excludeIds)
    rerender(
      <TranslationsProvider>
        <AgentSelector {...defaultProps} />
      </TranslationsProvider>
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect when an agent is clicked', async () => {
    renderWithTranslations(<AgentSelector {...defaultProps} />);

    resolveFetch({
      json: async () => mockAgents,
    });

    await waitFor(() => screen.getByText('SuperClaw'));
    fireEvent.click(screen.getByText('SuperClaw'));
    expect(defaultProps.onSelect).toHaveBeenCalledWith('superclaw');
  });

  it('handles fetch errors gracefully', async () => {
    renderWithTranslations(<AgentSelector {...defaultProps} />);

    resolveFetch(new Error('Network error'));

    await waitFor(() => {
      // It should stop loading even on error
      expect(screen.queryByText(/Synchronizing Agent Registry/i)).not.toBeInTheDocument();
    });
  });
});
