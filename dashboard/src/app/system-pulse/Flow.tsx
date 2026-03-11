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
  LayoutDashboard
} from 'lucide-react';
import { useReactFlow, ReactFlowProvider } from '@xyflow/react';
import { THEME } from '@/lib/theme';

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
        if (node.id === 'bus') { xPos = 400; yPos = 150; }
        else if (node.id === 'memory') { xPos = 700; yPos = 550; }
        else if (node.id === 'codebuild') { xPos = 400; yPos = 550; }
        else if (node.id === 'storage') { xPos = 100; yPos = 550; }
        else if (node.id === 'api') { xPos = 100; yPos = 150; }
        else if (node.id === 'dashboard') { xPos = 700; yPos = 150; }
        else if (node.id === 'main') { xPos = 425; yPos = -50; }
        else if (node.type === 'agent') {
            const agentIndex = topology.nodes.filter(n => n.type === 'agent' && n.id !== 'main').indexOf(node);
            xPos = 100 + (agentIndex * 220);
            yPos = 300;
        }

        let icon = <Database size={16} />;
        if (node.iconType === 'Terminal' || node.id === 'codebuild') icon = <Terminal size={16} />;
        else if (node.iconType === 'Dashboard' || node.id === 'dashboard') icon = <LayoutDashboard size={16} />;
        else if (node.iconType === 'Radio' || node.id === 'api') icon = <Radio size={16} />;
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
        const isMainOrch = edge.source === 'main' && edge.target === 'bus';
        const isBusSignal = edge.source === 'bus';
        
        newEdges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: true,
          label: isMainOrch ? 'ORCHESTRATE' : (isBusSignal ? 'SIGNAL' : undefined),
          labelStyle: { fill: isMainOrch ? '#00ffa3' : (isBusSignal ? '#f97316' : '#00f3ff'), fontSize: isMainOrch ? 10 : 8, fontWeight: 'bold' },
          labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
          style: { 
            stroke: isMainOrch ? '#00ffa3' : (isBusSignal ? '#f97316' : '#00f3ff'), 
            strokeWidth: isMainOrch ? 2 : 1,
            opacity: (isMainOrch || isBusSignal) ? 1 : 0.4,
            strokeDasharray: (isMainOrch || isBusSignal) ? undefined : '5,5'
          },
          markerEnd: { 
            type: MarkerType.ArrowClosed, 
            color: isMainOrch ? '#00ffa3' : (isBusSignal ? '#f97316' : '#00f3ff') 
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
          <div className="flex flex-col bg-black/80 border border-white/10 rounded-lg overflow-hidden backdrop-blur-md shadow-2xl">
              <button 
                onClick={() => zoomIn()}
                className={`p-3 text-white/60 hover:text-${THEME.COLORS.PRIMARY} hover:bg-white/5 transition-all border-b border-white/5 group pointer-events-auto`}
                title="Zoom In"
              >
                  <Plus size={18} className="group-active:scale-90 transition-transform" />
              </button>
              <button 
                onClick={() => zoomOut()}
                className={`p-3 text-white/60 hover:text-${THEME.COLORS.PRIMARY} hover:bg-white/5 transition-all border-b border-white/5 group pointer-events-auto`}
                title="Zoom Out"
              >
                  <Minus size={18} className="group-active:scale-90 transition-transform" />
              </button>
              <button 
                onClick={() => fitView()}
                className={`p-3 text-white/60 hover:text-${THEME.COLORS.PRIMARY} hover:bg-white/5 transition-all group pointer-events-auto`}
                title="Fit View"
              >
                  <Maximize size={18} className="group-active:scale-90 transition-transform" />
              </button>
          </div>
          
          <div className="bg-black/80 border border-white/10 rounded-lg p-3 backdrop-blur-md shadow-2xl flex items-center justify-center">
              <Lock size={14} className="text-white/30" />
          </div>
      </div>
      
      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-none">
          <div className={`flex items-center gap-2 px-3 py-1 bg-black/80 border border-${THEME.COLORS.PRIMARY}/30 rounded-full`}>
              <Radio size={12} className={`text-${THEME.COLORS.PRIMARY} animate-pulse`} />
              <span className={`text-[10px] font-bold text-${THEME.COLORS.PRIMARY} uppercase tracking-wider`}>LIVE_ARCHITECTURE_FEED</span>
          </div>
          <button 
            onClick={() => { setLoading(true); fetchBlueprint(); }}
            className="flex items-center gap-2 px-3 py-1 bg-black/80 border border-white/10 rounded-full hover:bg-white/5 transition-colors pointer-events-auto cursor-pointer group"
          >
              <RefreshCw size={10} className="text-white/90 group-hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-bold text-white/90 uppercase">Manual_Resync</span>
          </button>
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
