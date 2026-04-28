// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MissionControlHUD } from './MissionControlHUD';
import { TranslationsProvider } from '@/components/Providers/TranslationsProvider';
import { useRealtimeContext } from '@/components/Providers/RealtimeProvider';

// Mock RealtimeProvider
const { mockUseRealtimeContext } = vi.hoisted(() => ({
  mockUseRealtimeContext: vi.fn(() => ({
    subscribe: vi.fn(() => vi.fn()),
    isLive: true,
  })),
}));

vi.mock('@/components/Providers/RealtimeProvider', () => ({
  useRealtimeContext: mockUseRealtimeContext,
}));

// Mock TrustGauge (to avoid SVG rendering issues in simple tests)
vi.mock('@/components/TrustGauge', () => ({
  default: ({ score }: { score: number }) => <div data-testid="trust-gauge">{score}%</div>,
}));

describe('MissionControlHUD Component', () => {
  const defaultProps = {
    sessionId: 'sess-1',
    t: (key: string) => key,
  };

  it('renders metric sections correctly', () => {
    render(
      <TranslationsProvider>
        <MissionControlHUD {...defaultProps} />
      </TranslationsProvider>
    );

    expect(screen.getByText(/Cognitive_Metrics/i)).toBeInTheDocument();
    expect(screen.getByText(/Trust_Index:/i)).toBeInTheDocument();
    expect(screen.getByText(/Stability:/i)).toBeInTheDocument();
    expect(screen.getByText(/Budget_Used:/i)).toBeInTheDocument();
  });

  it('handles sessionId: null gracefully (Persistence)', () => {
    render(
      <TranslationsProvider>
        <MissionControlHUD {...defaultProps} sessionId={null} />
      </TranslationsProvider>
    );

    // Header and structure should still be there
    expect(screen.getByText(/Mission_Control/i)).toBeInTheDocument();
    expect(screen.getByText(/Nerve_Center_Ticker/i)).toBeInTheDocument();
  });

  it('toggles Autonomy Protocol mode', () => {
    render(
      <TranslationsProvider>
        <MissionControlHUD {...defaultProps} />
      </TranslationsProvider>
    );

    // Initially HITL (based on component state)
    const hitlLabel = screen.getByText('HITL');
    expect(hitlLabel).toBeInTheDocument();

    // Click toggle
    const toggleButton = screen.getByLabelText(/Toggle autonomy mode to/i);
    fireEvent.click(toggleButton);

    // Should now show AUTO as active (often indicated by color/classes, but here we check labels exist)
    expect(screen.getByText('AUTO')).toBeInTheDocument();
  });

  it('displays activity events', async () => {
    render(
      <TranslationsProvider>
        <MissionControlHUD {...defaultProps} />
      </TranslationsProvider>
    );

    // The component has a mock initial activity set in useEffect
    // Since we're using a short timeout in the component, we'll wait
    const activity = await screen.findByText(/Mission initialized/i);
    expect(activity).toBeInTheDocument();
  });

  it('initializes with custom mission scores', () => {
    const customMission = {
      trustScore: 75,
      stabilityScore: 60,
      budgetUsage: 45,
    };
    render(
      <TranslationsProvider>
        <MissionControlHUD {...defaultProps} mission={customMission} />
      </TranslationsProvider>
    );

    expect(screen.getAllByText('75%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('60%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('45%').length).toBeGreaterThanOrEqual(1);
  });

  it('updates metrics when a signal is received', async () => {
    let signalCallback: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    const subscribeMock = vi.fn((topics, callback) => {
      signalCallback = callback;
      return vi.fn(); // Unsubscribe
    });

    mockUseRealtimeContext.mockReturnValue({
      subscribe: subscribeMock,
      isLive: true,
    } as any);

    render(
      <TranslationsProvider>
        <MissionControlHUD {...defaultProps} />
      </TranslationsProvider>
    );

    expect(subscribeMock).toHaveBeenCalledWith(['sessions/sess-1/signal'], expect.any(Function));

    // Simulate signal
    signalCallback('sessions/sess-1/signal', {
      type: 'COGNITIVE_SIGNAL',
      trust: 99,
      stability: 95,
      budget: 10,
      content: 'Major breakthrough',
    });

    await waitFor(() => {
      expect(screen.getByText('Major breakthrough')).toBeInTheDocument();
    });
  });
});
