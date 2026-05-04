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

    // Check for new dynamic default mission data
    expect(screen.getByText(/Operation_SESS-1/i)).toBeInTheDocument();
  });

  it('renders even when sessionId is null (Persistence)', () => {
    render(<MissionBriefing {...defaultProps} sessionId={null} />);

    // Should still show the structure and Awaiting Mission state
    expect(screen.getByText(/Mission_Hub/i)).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByText(/Awaiting_Mission/i)).toBeInTheDocument();
  });

  it('formats operational phases correctly', () => {
    render(<MissionBriefing {...defaultProps} />);

    // Check for phases labels (based on new mock data in component)
    expect(screen.getByText('Context Acquisition')).toBeInTheDocument();
    expect(screen.getByText('Strategic Planning')).toBeInTheDocument();
    expect(screen.getByText('Execution')).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
  });

  it('displays custom mission data provided via props', () => {
    const customMission = {
      name: 'Custom_Mission_X',
      status: 'CRITICAL',
      goal: 'Win the game',
      phases: [{ id: '1', label: 'Phase One', status: 'active' as const }],
    };
    render(<MissionBriefing {...defaultProps} mission={customMission} />);

    expect(screen.getByText('Custom_Mission_X')).toBeInTheDocument();
    expect(screen.getByText('Phase One')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });
});
