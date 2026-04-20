// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import SystemPulseFlow, { getAgentIcon, getAgentDescription } from './Flow';
import { logger } from '@claw/core/lib/logger';

vi.mock('@claw/core/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFitView = vi.fn();

// Mock @xyflow/react
vi.mock('@xyflow/react', () => {
  return {
    ReactFlow: ({ nodes, edges, children }: { nodes: unknown[]; edges: unknown[]; children: React.ReactNode }) => (
      <div data-testid="react-flow" data-nodes={JSON.stringify(nodes)} data-edges={JSON.stringify(edges)}>
        {children}
      </div>
    ),
    Background: () => <div data-testid="background" />,
    Handle: () => <div data-testid="handle" />,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    useNodesState: (initialNodes: unknown) => {
      const [nodes, setNodes] = React.useState(initialNodes);
      const onNodesChange = vi.fn();
      return [nodes, setNodes, onNodesChange];
    },
    useEdgesState: (initialEdges: unknown) => {
      const [edges, setEdges] = React.useState(initialEdges);
      const onEdgesChange = vi.fn();
      return [edges, setEdges, onEdgesChange];
    },
    useReactFlow: () => ({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: mockFitView,
    }),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="react-flow-provider">{children}</div>,
  };
});

// Mock UI components
vi.mock('@/components/ui/Button', () => ({
  default: ({ children, onClick, icon, title }: { children: React.ReactNode; onClick: () => void; icon: React.ReactNode; title: string }) => (
    <button onClick={onClick} data-testid="button" title={title}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Typography', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="typography">{children}</div>,
}));

vi.mock('@/components/ui/Card', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Flow Component Logic', () => {
  describe('getAgentIcon', () => {
    it('returns icon for known agent IDs', () => {
      const icon = getAgentIcon('superclaw');
      expect(icon).toBeDefined();
    });

    it('returns icon for known icon keys', () => {
      const icon = getAgentIcon('unknown', 'BOT');
      expect(icon).toBeDefined();
    });

    it('returns fallback icon for unknown agents', () => {
      const icon = getAgentIcon('mystery-agent');
      expect(icon).toBeDefined();
    });
  });

  describe('getAgentDescription', () => {
    it('returns description for known agent IDs', () => {
      expect(getAgentDescription('superclaw')).toContain('orchestrates task delegation');
      expect(getAgentDescription('coder')).toContain('code generation');
    });

    it('returns fallback description for unknown agents', () => {
      expect(getAgentDescription('unknown')).toContain('Dynamic neural spoke');
    });
  });
});

describe('SystemPulseFlow Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<SystemPulseFlow />);
    expect(screen.getByText(/SYNCHRONIZING_NEURAL_MAP/i)).toBeInTheDocument();
  });

  it('fetches and renders topology data', async () => {
    const mockData = {
      nodes: [
        { id: 'superclaw', type: 'agent', tier: 'APP', label: 'SuperClaw' },
        { id: 'bus', type: 'bus', tier: 'COMM', label: 'Message Bus' },
      ],
      edges: [
        { id: 'e1', source: 'superclaw', target: 'bus', label: 'ORCHESTRATE' },
      ],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<SystemPulseFlow />);

    await waitFor(() => {
      expect(screen.queryByText(/SYNCHRONIZING_NEURAL_MAP/i)).not.toBeInTheDocument();
    });

    const flow = screen.getByTestId('react-flow');
    const nodes = JSON.parse(flow.getAttribute('data-nodes') || '[]');
    const edges = JSON.parse(flow.getAttribute('data-edges') || '[]');

    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).toBe('superclaw');
    expect(nodes[1].id).toBe('bus');
    
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('superclaw');
    expect(edges[0].target).toBe('bus');
  });

  it('handles diverse tiers and types in topology data', async () => {
    const mockData = {
      nodes: [
        { id: 'n1', type: 'agent', tier: 'APP', label: 'AppNode', enabled: true },
        { id: 'n2', type: 'bus', tier: 'COMM', label: 'CommNode' },
        { id: 'n3', type: 'infra', tier: 'INFRA', label: 'InfraNode' },
        { id: 'n4', type: 'agent', tier: 'AGENT', label: 'AgentNode' },
        { id: 'n5', type: 'unknown', tier: 'INFRA', label: 'OtherNode' },
        { id: 'n6', type: 'agent', tier: 'APP', label: 'OfflineNode', enabled: false },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
      ],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    render(<SystemPulseFlow />);

    await waitFor(() => {
      expect(screen.queryByText(/SYNCHRONIZING_NEURAL_MAP/i)).not.toBeInTheDocument();
    });

    const flow = screen.getByTestId('react-flow');
    const nodes = JSON.parse(flow.getAttribute('data-nodes') || '[]');
    expect(nodes).toHaveLength(6);
  });

  it('handles fetch error gracefully', async () => {
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('Fetch failed'));

    render(<SystemPulseFlow />);

    await waitFor(() => {
      expect(screen.queryByText(/SYNCHRONIZING_NEURAL_MAP/i)).not.toBeInTheDocument();
    });

    expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch system blueprint:', expect.any(Error));
    loggerSpy.mockRestore();
  });

  it('re-fetches data and fits view when reset button is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    });

    render(<SystemPulseFlow />);

    await waitFor(() => {
      expect(screen.queryByText(/SYNCHRONIZING_NEURAL_MAP/i)).not.toBeInTheDocument();
    });

    // Reset fetch mock to track new calls
    mockFetch.mockClear();
    
    const resetButton = screen.getByTitle('Reset View & Layout');
    fireEvent.click(resetButton);

    expect(screen.getByText(/SYNCHRONIZING_NEURAL_MAP/i)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByText(/SYNCHRONIZING_NEURAL_MAP/i)).not.toBeInTheDocument();
    });

    // Wait for setTimeout(() => fitView(), 100)
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mockFitView).toHaveBeenCalled();
  });
});
