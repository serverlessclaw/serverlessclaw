'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  Node,
  Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Zap,
  Terminal,
  Database,
  Brain,
  Activity,
  Search,
  FlaskConical,
  Settings2,
  RefreshCw,
  Radio,
  Info,
  Plus,
  Minus,
  Maximize,
  Lock,
  LayoutDashboard,
  MessageSquare,
  Bot,
  Code,
  Globe,
  MessageCircle,
  Hammer,
  Bell,
  Calendar,
} from 'lucide-react';
import { THEME } from '@/lib/theme';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { logger } from '@claw/core/lib/logger';

/**
 * Maps agnostic icon keys to Lucide components.
 */
export const ICON_COMPONENTS: Record<string, typeof Bot> = {
  APP: Globe,
  BOT: Bot,
  BRAIN: Brain,
  BUS: MessageCircle,
  DATABASE: Database,
  DASHBOARD: LayoutDashboard,
  HAMMER: Hammer,
  RADIO: Radio,
  SEND: MessageSquare,
  SIGNAL: Zap,
  STETHOSCOPE: Activity,
  ZAP: Zap,
  CODE: Code,
  SEARCH: Search,
  QA: FlaskConical,
  GEAR: Settings2,
  BELL: Bell,
  CALENDAR: Calendar,
};

/**
 * Data structure for React Flow nodes in the topology map.
 */
interface FlowNodeData {
  label: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  type: string;
}

/**
 * Interface for the infrastructure topology blueprint.
 */
interface BlueprintNode {
  id: string;
  type: string;
  tier: string;
  label: string;
  description?: string;
  icon?: string;
  iconType?: string;
  enabled?: boolean;
}

interface BlueprintEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface BlueprintTopology {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

/**
 * Visual constants for the flow components to avoid magic literals.
 */
const FLOW_COLORS = {
  CYBER_BLUE: '#00f3ff',
  NEON_GREEN: '#00ffa3',
  VIVID_ORANGE: '#f97316',
  SKY_BLUE: '#00d4ff',
  VIVID_YELLOW: '#ffcf00',
  FUCHSIA: '#d946ef',
  BG_BLACK: '#050505',
  BG_CARD: '#0a0a0a',
};

/**
 * Custom node components for the React Flow map.
 */
const nodeTypes = {
  agent: ({ data }: { data: FlowNodeData }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-background border border-cyber-green/50 min-w-[180px] max-w-[240px] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-16 h-16 bg-cyber-green/5 rounded-full blur-xl -mr-8 -mt-8"></div>
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-sm shrink-0 ${data.enabled ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-500/10 text-red-500'}`}
          >
            {data.icon}
          </div>
          <div className="overflow-hidden">
            <div
              className={`text-[10px] font-bold uppercase tracking-tighter truncate ${data.enabled ? 'text-cyber-green' : 'text-red-500'}`}
            >
              {data.type ?? 'NEURAL_NODE'} {!data.enabled && '[OFFLINE]'}
            </div>
            <div className="text-sm font-bold text-foreground break-words leading-tight">
              {data.label}
            </div>
          </div>
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-cyber-green/50 !border-none !w-2 !h-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-cyber-green/50 !border-none !w-2 !h-2"
        />
      </div>

      {/* Description Tooltip Above on Hover */}
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[220px] bg-card-elevated border border-cyber-green/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[var(--card-bg-elevated)]">
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className="text-cyber-green" />
          <span className="text-[8px] font-bold text-cyber-green uppercase tracking-widest">
            Documentation
          </span>
        </div>
        <p className="text-[10px] text-foreground leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
  bus: ({ data }: { data: FlowNodeData }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-2 shadow-lg rounded-md bg-background border border-orange-500/50 min-w-[220px] text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-orange-500/5 animate-pulse"></div>
        <div className="text-[8px] font-bold text-orange-500 uppercase tracking-[0.3em] mb-1 relative z-10">
          Central_Orchestrator
        </div>
        <div className="text-xs font-bold text-foreground flex items-center justify-center gap-2 relative z-10">
          <Zap size={14} className="text-orange-500" /> {data.label}
        </div>
        <Handle type="target" position={Position.Top} className="!bg-orange-500/50" />
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          className="!bg-orange-500/50"
        />
        <Handle type="source" position={Position.Left} id="left" className="!bg-orange-500/50" />
        <Handle type="source" position={Position.Right} id="right" className="!bg-orange-500/50" />
      </div>

      {/* Description Tooltip Above on Hover */}
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[240px] bg-card-elevated border border-orange-500/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none text-left after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[var(--card-bg-elevated)]">
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className="text-orange-500" />
          <span className="text-[8px] font-bold text-orange-500 uppercase tracking-widest">
            Protocol_Info
          </span>
        </div>
        <p className="text-[10px] text-foreground leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
  infra: ({ data }: { data: FlowNodeData }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div
        className={`px-4 py-2 shadow-lg rounded-md bg-background border border-${THEME.COLORS.INTEL}/30 min-w-[150px] relative overflow-hidden`}
      >
        <div
          className={`absolute top-0 right-0 w-12 h-12 bg-${THEME.COLORS.INTEL}/5 rounded-full blur-lg -mr-6 -mt-6`}
        ></div>
        <div className="flex items-center gap-3">
          <div className={`p-2 bg-${THEME.COLORS.INTEL}/10 rounded-sm text-${THEME.COLORS.INTEL}`}>
            {data.icon}
          </div>
          <div>
            <div
              className={`text-[10px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-tighter`}
            >
              {data.type ?? 'INFRA_SPOKE'}
            </div>
            <div className="text-sm font-bold text-foreground">{data.label}</div>
          </div>
        </div>
        <Handle type="target" position={Position.Top} className={`!bg-${THEME.COLORS.INTEL}/50`} />
        <Handle
          type="source"
          position={Position.Bottom}
          className={`!bg-${THEME.COLORS.INTEL}/50`}
        />
      </div>

      {/* Description Tooltip Above on Hover */}
      <div
        className={`absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[220px] bg-card-elevated border border-${THEME.COLORS.INTEL}/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[var(--card-bg-elevated)]`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className={`text-${THEME.COLORS.INTEL}`} />
          <span
            className={`text-[8px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-widest`}
          >
            Resource_Spec
          </span>
        </div>
        <p className="text-[10px] text-foreground leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
};

/**
 * Returns an appropriate Lucide icon for an agent based on ID or name.
 * @param id The agent ID.
 * @param iconName Optional icon name override.
 * @returns A React icon element.
 */
export const getAgentIcon = (id: string, iconKey?: string): React.ReactNode => {
  // 1. Try mapping the explicit iconKey (e.g. 'BOT', 'CODE')
  if (iconKey && ICON_COMPONENTS[iconKey]) {
    const Icon = ICON_COMPONENTS[iconKey];
    return <Icon size={16} />;
  }

  // 2. Legacy fallback for Lucide names if they leak through
  if (iconKey === 'Bot') return <Bot size={16} />;
  if (iconKey === 'Code') return <Code size={16} />;
  if (iconKey === 'Brain') return <Brain size={16} />;

  // 3. Mapping based on common agent IDs
  const idMap: Record<string, React.ReactNode> = {
    superclaw: <Bot size={16} />,
    coder: <Code size={16} />,
    'strategic-planner': <Brain size={16} />,
    'cognition-reflector': <Search size={16} />,
    monitor: <Activity size={16} />,
    qa: <FlaskConical size={16} />,
  };

  return idMap[id] ?? <Settings2 size={16} />;
};

/**
 * Returns a standardized description for known agents if one isn't provided.
 * @param id The agent ID.
 * @returns A descriptive string.
 */
export const getAgentDescription = (id: string): string => {
  const descMap: Record<string, string> = {
    superclaw: 'Processes input, retrieves memory, and orchestrates task delegation to spokes.',
    coder:
      'Specialized engine for heavy lifting: code generation, infra modification, and deployments.',
    'strategic-planner':
      'Intelligence node for analyzing capability gaps and designing long-term evolution.',
    'cognition-reflector': 'Cognitive auditor. Distills facts and lessons from interaction traces.',
    monitor: 'Observability node. Monitors system health and triggers automated fixes on failure.',
    qa: 'Verification auditor. Ensures deployed changes effectively resolve intended requirements.',
  };
  return (
    descMap[id] ??
    'Dynamic neural spoke for specialized task execution and decentralized intelligence.'
  );
};

/**
 * Main logical content of the topology flow.
 */
export function FlowContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  /**
   * Fetches and builds the infrastructure topology map.
   */
  const fetchBlueprint = useCallback(async () => {
    try {
      const infraRes = await fetch('/api/infrastructure');
      if (!infraRes.ok) throw new Error('Failed to fetch infrastructure data');

      const topology: BlueprintTopology = await infraRes.json();

      const topologyNodes = topology?.nodes || [];
      const topologyEdges = topology?.edges || [];

      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      // Degree calculation for spatial layout
      const nodeDegrees: Record<string, number> = {};
      topologyEdges.forEach((edge) => {
        nodeDegrees[edge.source] = (nodeDegrees[edge.source] ?? 0) + 1;
        nodeDegrees[edge.target] = (nodeDegrees[edge.target] ?? 0) + 1;
      });

      // Spatial tiers for layout
      const tiers = ['APP', 'GATEWAY', 'COMM', 'AGENT', 'UTILITY', 'INFRA'];
      const TIER_Y: Record<string, number> = {
        APP: -100,
        GATEWAY: 80,
        COMM: 240,
        AGENT: 420,
        UTILITY: 580,
        INFRA: 740,
      };

      tiers.forEach((tier) => {
        const nodesInTier = topologyNodes.filter(
          (n) => (n.tier?.toUpperCase() || 'INFRA') === tier
        );

        // Horizontal centering based on degree
        nodesInTier.sort((a, b) => (nodeDegrees[b.id] ?? 0) - (nodeDegrees[a.id] ?? 0));

        const centeredNodes: BlueprintNode[] = [];
        nodesInTier.forEach((node, idx) => {
          if (idx % 2 === 0) centeredNodes.push(node);
          else centeredNodes.unshift(node);
        });

        const totalInTier = centeredNodes.length;
        const yPos = TIER_Y[tier] ?? 700;

        let spacing = 260;
        if (tier === 'AGENT') spacing = 230;
        if (tier === 'COMM') spacing = 320;
        if (tier === 'UTILITY') spacing = 240;
        if (tier === 'INFRA') spacing = 280;
        if (tier === 'GATEWAY' || tier === 'COMM') spacing = 300;

        const totalWidth = (totalInTier - 1) * spacing;
        const startX = 400 - totalWidth / 2;

        centeredNodes.forEach((node, nodeIndex) => {
          const xPos = startX + nodeIndex * spacing;

          let icon: React.ReactNode = <Database size={16} />;

          // Use the centralized mapping if iconKey is present
          if (node.icon && ICON_COMPONENTS[node.icon]) {
            const Icon = ICON_COMPONENTS[node.icon];
            icon = <Icon size={16} />;
          }
          // Custom overrides for specific node IDs or types
          else if (['codebuild', 'deployer'].includes(node.id)) icon = <Terminal size={16} />;
          else if (node.id === 'dashboard') icon = <LayoutDashboard size={16} />;
          else if (['api', 'webhookapi', 'scheduler'].includes(node.id)) icon = <Radio size={16} />;
          else if (node.id === 'monitor') icon = <Activity size={16} />;
          else if (node.id === 'telegram') icon = <MessageSquare size={16} />;
          else if (['bridge', 'realtimebridge', 'realtimebus', 'heartbeat'].includes(node.id))
            icon = <Zap size={16} />;
          else if (node.id === 'notifier') icon = <Info size={16} />;
          else if (node.type === 'agent') icon = getAgentIcon(node.id, node.icon);

          newNodes.push({
            id: node.id,
            type: node.type === 'dashboard' ? 'infra' : node.type,
            position: { x: xPos, y: yPos },
            data: {
              label: node.label,
              description: node.description ?? getAgentDescription(node.id),
              icon,
              enabled: node.enabled ?? true,
              type:
                node.id === 'superclaw'
                  ? 'Logic_Core'
                  : ['agentbus', 'bus'].includes(node.id)
                    ? 'ORCHESTRATOR'
                    : node.type === 'agent'
                      ? 'Neural_Worker'
                      : node.tier === 'UTILITY'
                        ? 'Functional_Handler'
                        : node.id === 'memorytable'
                          ? 'DATA_STORE'
                          : node.id === 'stagingbucket'
                            ? 'STORAGE'
                            : node.id === 'deployer'
                              ? 'COMPUTE'
                              : 'INFRA_NODE',
            },
          });
        });
      });

      // Edge processing
      topologyEdges.forEach((edge) => {
        const isMainOrch =
          edge.label === 'ORCHESTRATE' || (edge.source === 'superclaw' && edge.target === 'bus');
        const isBusSignal =
          edge.label === 'SIGNAL' || edge.label?.startsWith('SIGNAL_') || edge.source === 'bus';
        const isResult = edge.label === 'RESULT';
        const isInvoke = edge.label === 'INVOKE';
        const isProactive = edge.label === 'SCHEDULE' || edge.label === 'HEARTBEAT';

        let strokeColor = FLOW_COLORS.CYBER_BLUE;
        if (isMainOrch) strokeColor = FLOW_COLORS.NEON_GREEN;
        if (isBusSignal) strokeColor = FLOW_COLORS.VIVID_ORANGE;
        if (isResult) strokeColor = FLOW_COLORS.SKY_BLUE;
        if (isInvoke) strokeColor = FLOW_COLORS.VIVID_YELLOW;
        if (isProactive) strokeColor = FLOW_COLORS.FUCHSIA;

        const isBiDirectional = topologyEdges.some(
          (e) => e.source === edge.target && e.target === edge.source
        );
        const edgeIndex = topologyEdges.indexOf(edge);
        const reverseEdgeIndex = topologyEdges.findIndex(
          (e) => e.source === edge.target && e.target === edge.source
        );
        const isPrimary = !isBiDirectional || edgeIndex < reverseEdgeIndex;

        newEdges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: true,
          type: 'default',
          label: edge.label ?? (isMainOrch ? 'ORCHESTRATE' : isBusSignal ? 'SIGNAL' : undefined),
          labelStyle: {
            fill: strokeColor,
            fontSize: isMainOrch || isProactive ? 10 : 8,
            fontWeight: 'black',
            fontFamily: 'monospace',
            transform: isBiDirectional ? `translate(0, ${isPrimary ? -16 : 16}px)` : undefined,
          },
          labelBgStyle: { fill: '#010101', fillOpacity: 0.7 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 2,
          style: {
            stroke: strokeColor,
            strokeWidth: isMainOrch || isProactive ? 2.5 : isBusSignal ? 1.5 : 1.2,
            opacity: isMainOrch || isBusSignal || isResult || isInvoke || isProactive ? 1 : 0.6,
            strokeDasharray:
              isMainOrch || isBusSignal || isResult || isInvoke || isProactive ? undefined : '5,5',
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: strokeColor,
            width: 20,
            height: 20,
          },
        });
      });

      setNodes(newNodes);
      setEdges(newEdges);
      setLoading(false);
    } catch (e) {
      logger.error('Failed to fetch system blueprint:', e);
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    fetchBlueprint();
  }, [fetchBlueprint]);

  /**
   * Resets the viewport and refetches the configuration.
   */
  const handleReset = useCallback(async () => {
    setLoading(true);
    await fetchBlueprint();
    setTimeout(() => fitView(), 100);
  }, [fetchBlueprint, fitView]);

  return (
    <div className="absolute inset-0 bg-background rounded-lg border border-border overflow-hidden">
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-20 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw size={32} className={`text-${THEME.COLORS.PRIMARY} animate-spin`} />
            <div
              className={`text-xs font-bold text-${THEME.COLORS.PRIMARY} animate-pulse tracking-[0.3em]`}
            >
              SYNCHRONIZING_NEURAL_MAP...
            </div>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          className="bg-dot-pattern"
        >
          <Background color="var(--color-muted-more)" gap={20} />
        </ReactFlow>
      )}

      {/* Custom Themed Map Controls */}
      <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2">
        <Card
          variant="solid"
          padding="none"
          className="flex flex-col overflow-hidden backdrop-blur-md shadow-2xl"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => zoomIn()}
            className="border-b border-border p-3 rounded-none text-muted-foreground hover:text-cyber-green"
            title="Zoom In"
            icon={<Plus size={18} className="group-active:scale-90 transition-transform" />}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => zoomOut()}
            className="border-b border-border p-3 rounded-none text-muted-foreground hover:text-cyber-green"
            title="Zoom Out"
            icon={<Minus size={18} className="group-active:scale-90 transition-transform" />}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="p-3 rounded-none text-muted-foreground hover:text-cyber-green"
            title="Reset View & Layout"
            icon={<Maximize size={18} className="group-active:scale-90 transition-transform" />}
          />
        </Card>

        <div className="bg-card/80 border border-border rounded-lg p-3 backdrop-blur-md shadow-2xl flex items-center justify-center">
          <Lock size={14} className="text-muted-foreground" />
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-none">
        <div
          className={`flex items-center gap-2 px-3 py-1 bg-card/80 border border-${THEME.COLORS.PRIMARY}/30 rounded-full`}
        >
          <Radio size={12} className={`text-${THEME.COLORS.PRIMARY} animate-pulse`} />
          <Typography variant="caption" weight="bold" color="primary" uppercase>
            Live Architecture Feed
          </Typography>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchBlueprint();
          }}
          className="bg-card/80 rounded-full hover:bg-card-elevated group pointer-events-auto"
          icon={
            <RefreshCw
              size={10}
              className="text-foreground group-hover:rotate-180 transition-transform duration-500"
            />
          }
        >
          <Typography variant="caption" weight="bold" color="white" uppercase>
            Manual Resync
          </Typography>
        </Button>
      </div>
    </div>
  );
}

/**
 * Higher-level wrapper ensuring React Flow context is available.
 */
export default function SystemPulseFlow() {
  return (
    <ReactFlowProvider>
      <FlowContent />
    </ReactFlowProvider>
  );
}
