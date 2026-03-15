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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  Bot, Zap, Code, ShieldCheck, Terminal, Cpu, 
  Database, Brain, Activity, Search, FlaskConical, 
  Settings2, RefreshCw, Radio, Info, Plus, Minus, Maximize, Lock,
  LayoutDashboard, Send, MessageSquare
} from 'lucide-react';
import { useReactFlow, ReactFlowProvider } from '@xyflow/react';
import { THEME } from '@/lib/theme';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';

const nodeTypes = {
  agent: ({ data }: any) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className={`px-4 py-3 shadow-lg rounded-md bg-black border border-cyber-green/50 min-w-[180px] max-w-[240px] relative overflow-hidden`}>
        <div className="absolute top-0 right-0 w-16 h-16 bg-cyber-green/5 rounded-full blur-xl -mr-8 -mt-8"></div>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-sm shrink-0 ${data.enabled ? 'bg-cyber-green/10 text-cyber-green' : 'bg-red-500/10 text-red-500'}`}>
            {data.icon}
          </div>
          <div className="overflow-hidden">
            <div className={`text-[10px] font-bold uppercase tracking-tighter truncate ${data.enabled ? 'text-cyber-green' : 'text-red-500'}`}>
              {data.type || 'NEURAL_NODE'} {!data.enabled && '[OFFLINE]'}
            </div>
            <div className="text-sm font-bold text-white/90 break-words leading-tight">{data.label}</div>
          </div>
        </div>
        <Handle type="target" position={Position.Top} className="!bg-cyber-green/50 !border-none !w-2 !h-2" />
        <Handle type="source" position={Position.Bottom} className="!bg-cyber-green/50 !border-none !w-2 !h-2" />
      </div>
      
      {/* Description Tooltip Above on Hover */}
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[220px] bg-[#0a0a0a] border border-cyber-green/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[#0a0a0a]">
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className="text-cyber-green" />
          <span className="text-[8px] font-bold text-cyber-green uppercase tracking-widest">Documentation</span>
        </div>
        <p className="text-[10px] text-white/100 leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
  bus: ({ data }: any) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-2 shadow-lg rounded-md bg-black border border-orange-500/50 min-w-[220px] text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-orange-500/5 animate-pulse"></div>
          <div className="text-[8px] font-bold text-orange-500 uppercase tracking-[0.3em] mb-1 relative z-10">Central_Orchestrator</div>
          <div className="text-xs font-bold text-white flex items-center justify-center gap-2 relative z-10">
              <Zap size={14} className="text-orange-500" /> {data.label}
          </div>
          <Handle type="target" position={Position.Top} className="!bg-orange-500/50" />
          <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-orange-500/50" />
          <Handle type="source" position={Position.Left} id="left" className="!bg-orange-500/50" />
          <Handle type="source" position={Position.Right} id="right" className="!bg-orange-500/50" />
      </div>

      {/* Description Tooltip Above on Hover */}
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[240px] bg-[#0a0a0a] border border-orange-500/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none text-left after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[#0a0a0a]">
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className="text-orange-500" />
          <span className="text-[8px] font-bold text-orange-500 uppercase tracking-widest">Protocol_Info</span>
        </div>
        <p className="text-[10px] text-white/100 leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
  infra: ({ data }: any) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className={`px-4 py-2 shadow-lg rounded-md bg-[#0a0a0a] border border-${THEME.COLORS.INTEL}/30 min-w-[150px] relative overflow-hidden`}>
        <div className={`absolute top-0 right-0 w-12 h-12 bg-${THEME.COLORS.INTEL}/5 rounded-full blur-lg -mr-6 -mt-6`}></div>
        <div className="flex items-center gap-3">
          <div className={`p-2 bg-${THEME.COLORS.INTEL}/10 rounded-sm text-${THEME.COLORS.INTEL}`}>
            {data.icon}
          </div>
          <div>
            <div className={`text-[10px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-tighter`}>
              {data.type || 'INFRA_SPOKE'}
            </div>
            <div className="text-sm font-bold text-white/90">{data.label}</div>
          </div>
        </div>
        <Handle type="target" position={Position.Top} className={`!bg-${THEME.COLORS.INTEL}/50`} />
        <Handle type="source" position={Position.Bottom} className={`!bg-${THEME.COLORS.INTEL}/50`} />
      </div>

      {/* Description Tooltip Above on Hover */}
      <div className={`absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[220px] bg-[#0a0a0a] border border-${THEME.COLORS.INTEL}/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[#0a0a0a]`}>
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className={`text-${THEME.COLORS.INTEL}`} />
          <span className={`text-[8px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-widest`}>Resource_Spec</span>
        </div>
        <p className="text-[10px] text-white/100 leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
};

const getAgentIcon = (id: string, iconName?: string) => {
  if (iconName === 'Bot') return <Bot size={16} />;
  if (iconName === 'Code') return <Code size={16} />;
  if (iconName === 'Brain') return <Brain size={16} />;
  if (iconName === 'Search') return <Search size={16} />;
  if (iconName === 'Activity') return <Activity size={16} />;
  if (iconName === 'FlaskConical') return <FlaskConical size={16} />;
  
  // Fallbacks if not provided in config
  if (id === 'main') return <Bot size={16} />;
  if (id === 'coder') return <Code size={16} />;
  if (id === 'strategic-planner') return <Brain size={16} />;
  if (id === 'cognition-reflector') return <Search size={16} />;
  if (id === 'monitor') return <Activity size={16} />;
  if (id === 'qa') return <FlaskConical size={16} />;
  return <Settings2 size={16} />;
};

const getAgentDescription = (id: string) => {
  const descMap: Record<string, string> = {
    'main': 'SuperClaw. Processes input, retrieves long-term memory, and decides when to delegate tasks to spokes.',
    'coder': 'Specialised agent that performs heavy lifting like writing code, modifying infra, and triggering builds.',
    'strategic-planner': 'Strategic intelligence node. Analyzes capability gaps and designs long-term evolution plans.',
    'cognition-reflector': 'Cognitive audit node. Distills facts, lessons, and capability gaps from interaction traces.',
    'monitor': 'Real-time observability node. Watches AWS CodeBuild events and triggers fix tasks on failure.',
    'qa': 'Verification node. Audits recently deployed code to ensure it actually solves the intended capability gap.',
  };
  return descMap[id] || 'Neural spoke for dynamic task execution and decentralized intelligence.';
};

const getEdgeType = (source: string, target: string, allEdges: any[]) => {
  return 'default'; // Use Bezier curves as preferred by the user
};

export function FlowContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const fetchBlueprint = useCallback(async () => {
    try {
      const infraRes = await fetch('/api/infrastructure');
      const topology: { nodes: any[]; edges: any[] } = await infraRes.json();
      
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      // 1. Process Nodes
      topology.nodes.forEach((node: any, index: number) => {
        let xPos = 100 + (index % 4) * 250;
        let yPos = 100 + Math.floor(index / 4) * 200;
        
        // Logical clustering for core resources
        // 1. Layer 1: Top - User Interfaces & Entry Points (Y: -100)
        if (node.id === 'api') { xPos = 200; yPos = -100; }
        // 1. Layer 1: Entrance (Y: -100)
        if (node.id === 'telegram') { xPos = 350; yPos = -100; }
        else if (node.id === 'api' || node.id === 'webhookapi') { xPos = 350; yPos = 0; }

        // 1.5 Layer 1.5: The Brain - SuperClaw (Y: 50)
        else if (node.id === 'main' || node.id === 'superclaw') { xPos = 350; yPos = 100; }

        // 2. Layer 2: Neural Bus & Comms (Y: 200)
        else if (node.id === 'bus' || node.id === 'agentbus') { xPos = 350; yPos = 200; }
        else if (node.id === 'notifier') { xPos = 650; yPos = 200; }
        else if (node.id === 'bridge' || node.id === 'realtimebridge' || node.id === 'realtimebus') { xPos = 50; yPos = 200; }
        // 2.5 Layer 2.5: Proactive Goals & Scheduling (Y: 325)
        else if (node.id === 'scheduler') { xPos = 550; yPos = 325; }
        else if (node.id === 'heartbeat') { xPos = 350; yPos = 325; }
        
        // 3. Layer 3: Logic Units & Workers (Y: 450)
        else if (node.type === 'agent' || node.id === 'monitor') {
            const allAgents = topology.nodes.filter(n => 
                (n.type === 'agent' || n.id === 'monitor') && n.id !== 'main' && n.id !== 'superclaw'
            );
            const agentIndex = allAgents.findIndex(n => n.id === node.id);
            const totalAgents = allAgents.length;
            const startX = 350 - ((totalAgents - 1) * 150);
            xPos = startX + (agentIndex * 300);
            yPos = 450;
        }
        
        // 4. Layer 4: Bottom - Infrastructure & Persistence (Y: 800)
        else {
            const infraNodes = [
                'tracetable', 'stagingbucket', 'memorytable', 'configtable', 'deployer', 'knowledgebucket'
            ];
            const infraIndex = infraNodes.indexOf(node.id);
            if (infraIndex !== -1) {
                // startX + (2 * 150) = 350 => startX = 50
                const startX = 50;
                xPos = startX + (infraIndex * 150);
                yPos = 800;
            } else {
                xPos = index * 200;
                yPos = 1100;
            }
        }

        let icon = <Database size={16} />;
        if (node.iconType === 'Terminal' || node.id === 'codebuild' || node.id === 'deployer') icon = <Terminal size={16} />;
        else if (node.iconType === 'Dashboard' || node.id === 'dashboard') icon = <LayoutDashboard size={16} />;
        else if (node.id === 'api' || node.id === 'webhookapi') icon = <Radio size={16} />;
        else if (node.id === 'monitor') icon = <Activity size={16} />;
        else if (node.id === 'telegram') icon = <MessageSquare size={16} />;
        else if (node.id === 'bridge' || node.id === 'realtimebus') icon = <Zap size={16} />;
        else if (node.id === 'notifier') icon = <Info size={16} />;
        else if (node.id === 'scheduler') icon = <Radio size={16} />;
        else if (node.id === 'heartbeat') icon = <Zap size={16} />;
        else if (node.type === 'agent') icon = getAgentIcon(node.id, node.icon);

        newNodes.push({
          id: node.id,
          type: node.type === 'dashboard' ? 'infra' : node.type,
          position: { x: xPos, y: yPos },
          data: { 
            label: node.label,
            description: node.description || getAgentDescription(node.id),
            icon,
            enabled: node.enabled !== undefined ? node.enabled : true,
            type: node.id === 'main' ? 'Logic_Core' : (node.type === 'agent' ? 'Neural_Worker' : (node.id === 'memory' ? 'DATA_STORE' : (node.id === 'storage' ? 'STORAGE' : 'COMPUTE')))
          },
        });
      });

      // 2. Process Edges
      topology.edges.forEach((edge: any) => {
        const isMainOrch = edge.label === 'ORCHESTRATE' || (edge.source === 'main' && edge.target === 'bus');
        const isBusSignal = edge.label === 'SIGNAL' || edge.label?.startsWith('SIGNAL_') || edge.source === 'bus';
        const isResult = edge.label === 'RESULT';
        const isInvoke = edge.label === 'INVOKE';
        const isProactive = edge.label === 'SCHEDULE' || edge.label === 'HEARTBEAT';
        
        let strokeColor = '#00f3ff'; // Cyber blue (Default)
        if (isMainOrch) strokeColor = '#00ffa3'; // Neon green
        if (isBusSignal) strokeColor = '#f97316'; // Vivid orange
        if (isResult) strokeColor = '#00d4ff'; // Sky blue
        if (isInvoke) strokeColor = '#ffcf00'; // Yellow
        if (isProactive) strokeColor = '#d946ef'; // Fuchsia

        const isBiDirectional = topology.edges.some((e: any) => e.source === edge.target && e.target === edge.source);
        const edgeIndex = topology.edges.indexOf(edge);
        const reverseEdgeIndex = topology.edges.findIndex((e: any) => e.source === edge.target && e.target === edge.source);
        const isPrimary = !isBiDirectional || edgeIndex < reverseEdgeIndex;
        
        newEdges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: true,
          type: 'default',
          label: edge.label || (isMainOrch ? 'ORCHESTRATE' : (isBusSignal ? 'SIGNAL' : undefined)),
          labelStyle: { 
            fill: strokeColor, 
            fontSize: (isMainOrch || isProactive) ? 10 : 8, 
            fontWeight: 'black', 
            fontFamily: 'monospace',
            transform: isBiDirectional ? `translate(0, ${isPrimary ? -12 : 12}px)` : undefined
          },
          labelBgStyle: { fill: '#010101', fillOpacity: 0.95 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 4,
          style: { 
            stroke: strokeColor, 
            strokeWidth: (isMainOrch || isProactive) ? 2.5 : (isBusSignal ? 1.5 : 1.2),
            opacity: (isMainOrch || isBusSignal || isResult || isInvoke || isProactive) ? 1 : 0.6,
            strokeDasharray: (isMainOrch || isBusSignal || isResult || isInvoke || isProactive) ? undefined : '5,5'
          },
          markerEnd: { 
            type: MarkerType.ArrowClosed, 
            color: strokeColor,
            width: 20,
            height: 20
          }
        });
      });

      setNodes(newNodes);
      setEdges(newEdges);
      setLoading(false);
    } catch (e) {
      console.error('Failed to fetch system blueprint:', e);
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => { fetchBlueprint(); }, [fetchBlueprint]);

  const handleReset = useCallback(async () => {
    setLoading(true);
    await fetchBlueprint();
    setTimeout(() => fitView(), 100);
  }, [fetchBlueprint, fitView]);

  return (
    <div className="h-full w-full bg-[#050505] rounded-lg border border-white/5 relative overflow-hidden">
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw size={32} className={`text-${THEME.COLORS.PRIMARY} animate-spin`} />
            <div className={`text-xs font-bold text-${THEME.COLORS.PRIMARY} animate-pulse tracking-[0.3em]`}>SYNCHRONIZING_NEURAL_MAP...</div>
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
          <Background color="#222" gap={20} />
        </ReactFlow>
      )}
      
      {/* Custom Themed Map Controls */}
      <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2">
          <Card variant="solid" padding="none" className="flex flex-col overflow-hidden backdrop-blur-md shadow-2xl">
              <Button 
                variant="ghost"
                size="sm"
                onClick={() => zoomIn()}
                className="border-b border-white/5 p-3 rounded-none text-white/60 hover:text-cyber-green"
                title="Zoom In"
                icon={<Plus size={18} className="group-active:scale-90 transition-transform" />}
              />
              <Button 
                variant="ghost"
                size="sm"
                onClick={() => zoomOut()}
                className="border-b border-white/5 p-3 rounded-none text-white/60 hover:text-cyber-green"
                title="Zoom Out"
                icon={<Minus size={18} className="group-active:scale-90 transition-transform" />}
              />
              <Button 
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="p-3 rounded-none text-white/60 hover:text-cyber-green"
                title="Reset View & Layout"
                icon={<Maximize size={18} className="group-active:scale-90 transition-transform" />}
              />
          </Card>
          
          <div className="bg-black/80 border border-white/10 rounded-lg p-3 backdrop-blur-md shadow-2xl flex items-center justify-center">
              <Lock size={14} className="text-white/30" />
          </div>
      </div>
      
      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-none">
          <div className={`flex items-center gap-2 px-3 py-1 bg-black/80 border border-${THEME.COLORS.PRIMARY}/30 rounded-full`}>
              <Radio size={12} className={`text-${THEME.COLORS.PRIMARY} animate-pulse`} />
              <Typography variant="caption" weight="bold" color="primary" uppercase>Live Architecture Feed</Typography>
          </div>
          <Button 
            variant="outline"
            size="sm"
            onClick={() => { setLoading(true); fetchBlueprint(); }}
            className="bg-black/80 rounded-full hover:bg-white/5 group"
            icon={<RefreshCw size={10} className="text-white/90 group-hover:rotate-180 transition-transform duration-500" />}
          >
            <Typography variant="caption" weight="bold" color="white" uppercase>Manual Resync</Typography>
          </Button>
      </div>
    </div>
  );
}

export default function SystemPulseFlow() {
  return (
    <ReactFlowProvider>
      <FlowContent />
    </ReactFlowProvider>
  );
}
