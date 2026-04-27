// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MissionBriefing } from './MissionBriefing';

// Mock PresenceProvider
vi.mock('@/components/Providers/PresenceProvider', () => ({
  usePresence: () => ({
    members: [],
    myPresence: {
      memberId: 'user-1',
      displayName: 'Operator',
      type: 'human',
      status: 'online',
    },
  }),
}));

describe('MissionBriefing Component', () => {
  const defaultProps = {
    sessionId: 'sess-1',
    collaborators: ['agent-alpha'],
    t: (key: string) => key,
  };

  it('renders correctly with an active session', () => {
    render(<MissionBriefing {...defaultProps} />);

    // Check for Hub title
    expect(screen.getByText(/Mission_Hub/i)).toBeInTheDocument();

    // Check for collaborators
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByText('agent-alpha')).toBeInTheDocument();

    // Check for mission data
    expect(screen.getByText(/Operation_Cobalt_Shield/i)).toBeInTheDocument();
  });

  it('renders even when sessionId is null (Persistence)', () => {
    render(<MissionBriefing {...defaultProps} sessionId={null} />);

    // Should still show the structure and mock data
    expect(screen.getByText(/Mission_Hub/i)).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByText(/Mission_Briefing/i)).toBeInTheDocument();
  });

  it('formats operational phases correctly', () => {
    render(<MissionBriefing {...defaultProps} />);

    // Check for phases labels (based on mock data in component)
    expect(screen.getByText('Analysis')).toBeInTheDocument();
    expect(screen.getByText('Testing')).toBeInTheDocument();
    expect(screen.getByText('Deployment')).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();

    // Verify status labels
    const completedPhases = screen.getAllByText('completed');
    expect(completedPhases.length).toBeGreaterThanOrEqual(2);
  });
});
