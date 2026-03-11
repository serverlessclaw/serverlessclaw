'use client';

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  NodeProps,
  Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Zap, Bot, Database, Server, Info, Terminal, LayoutDashboard } from 'lucide-react';
import { THEME } from '@/lib/theme';

// --- Custom Node Components ---

const AgentNode = ({ data }: NodeProps) => (
  <div className={`px-4 py-3 shadow-[0_0_20px_rgba(0,224,255,0.1)] rounded-sm bg-black border border-cyber-blue/40 min-w-[180px] group transition-all hover:border-cyber-blue hover:shadow-[0_0_30px_rgba(0,224,255,0.2)]`}>
    <Handle type="target" position={Position.Top} className="!bg-cyber-blue/50" />
    <div className="flex items-center gap-3">
      <div className="p-2 rounded bg-cyber-blue/10 text-cyber-blue">
        <Bot size={16} />
      </div>
      <div className="text-left">
        <div className="text-[8px] font-bold text-cyber-blue uppercase tracking-widest opacity-70 mb-0.5">Neural_Node</div>
        <div className="text-[11px] font-bold text-white/90">{data.label as string}</div>
      </div>
    </div>
    <Handle type="source" position={Position.Bottom} className="!bg-cyber-blue/50" />
    
    {/* Tooltip on hover */}
    <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[200px] bg-[#0a0a0a] border border-white/10 p-2 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50 pointer-events-none text-left">
        <p className="text-[10px] text-white/70 italic leading-relaxed">
            {data.description as string}
        </p>
    </div>
  </div>
);

const CentralNode = ({ data }: NodeProps) => (
  <div className="group relative">
      <div className={`px-4 py-2 shadow-lg rounded-md bg-black border border-${THEME.COLORS.INTEL}/50 min-w-[220px] text-center relative overflow-hidden`}>
          <div className={`absolute inset-0 bg-${THEME.COLORS.INTEL}/5 animate-pulse`}></div>
          <div className={`text-[8px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-[0.3em] mb-1 relative z-10`}>Central_Orchestrator</div>
          <div className="text-sm font-black text-white tracking-tighter flex items-center justify-center gap-2 relative z-10">
              <Zap size={14} className={`text-${THEME.COLORS.INTEL}`} /> {data.label as string}
          </div>
          <Handle type="target" position={Position.Top} className={`!bg-${THEME.COLORS.INTEL}/50`} />
          <Handle type="source" position={Position.Bottom} id="bottom" className={`!bg-${THEME.COLORS.INTEL}/50`} />
          <Handle type="source" position={Position.Left} id="left" className={`!bg-${THEME.COLORS.INTEL}/50`} />
          <Handle type="source" position={Position.Right} id="right" className={`!bg-${THEME.COLORS.INTEL}/50`} />
      </div>

      {/* Expanded Details on Hover */}
      <div className={`absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[240px] bg-[#0a0a0a] border border-${THEME.COLORS.INTEL}/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none text-left after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[#0a0a0a]`}>
        <div className="flex items-center gap-2 mb-2">
          <Info size={10} className={`text-${THEME.COLORS.INTEL}`} />
          <span className={`text-[8px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-widest`}>Protocol_Info</span>
        </div>
        <p className="text-[10px] text-white/70 leading-relaxed">
            {data.description as string}
        </p>
      </div>
  </div>
);

const InfraNode = ({ data }: NodeProps) => {
    const Icon = data.iconType === 'Terminal' ? Terminal : data.iconType === 'Dashboard' ? LayoutDashboard : Database;
    return (
        <div className="px-4 py-2 rounded bg-black border border-white/10 min-w-[160px] flex items-center gap-3">
            <Handle type="target" position={Position.Top} className="!bg-white/20" />
            <div className="p-1.5 rounded bg-white/5 text-white/40">
                <Icon size={14} />
            </div>
            <div className="text-left">
                <div className="text-[7px] font-bold text-white/30 uppercase tracking-widest">Hardware_Node</div>
                <div className="text-[10px] font-bold text-white/60">{data.label as string}</div>
            </div>
            <Handle type="source" position={Position.Bottom} className="!bg-white/20" />
        </div>
    );
};

const BusNode = ({ data }: NodeProps) => (
  <div className="px-6 py-2 shadow-[0_0_15px_rgba(0,255,163,0.1)] rounded-full bg-black border border-cyber-green/30 min-w-[140px] text-center">
    <Handle type="target" position={Position.Top} className="!bg-cyber-green/50" />
    <div className="text-[7px] font-bold text-cyber-green uppercase tracking-[0.4em] mb-0.5">High_Speed_Bus</div>
    <div className="text-[10px] font-bold text-white/80">{data.label as string}</div>
    <Handle type="source" position={Position.Bottom} id="out" className="!bg-cyber-green/50" />
    <Handle type="source" position={Position.Left} id="out-left" className="!bg-cyber-green/50" />
    <Handle type="source" position={Position.Right} id="out-right" className="!bg-cyber-green/50" />
  </div>
);

const nodeTypes = {
  central: CentralNode,
  agent: AgentNode,
  infra: InfraNode,
  bus: BusNode,
};

// --- Initial Nodes & Edges ---

const initialNodes = [
  {
    id: 'superclaw',
    type: 'central',
    position: { x: 250, y: 0 },
    data: { 
        label: 'SuperClaw',
        description: 'Primary decision engine and task orchestrator. Dispatches logic to specialized agents via the AgentBus.'
    },
  },
  {
    id: 'bus',
    type: 'bus',
    position: { x: 280, y: 150 },
    data: { label: 'AgentBus' },
  },
  {
    id: 'memory',
    type: 'infra',
    position: { x: 0, y: 100 },
    data: { label: 'MemoryTable', description: 'DynamoDB cluster storing long-term memory and capability gaps.' },
  },
  {
    id: 'coder',
    type: 'agent',
    position: { x: 50, y: 300 },
    data: { label: 'Coder Agent', description: 'Implements code changes and infrastructure updates autonomously.' },
  },
  {
    id: 'planner',
    type: 'agent',
    position: { x: 280, y: 300 },
    data: { label: 'Strategic Planner', description: 'Analyzes gaps and designs multi-step evolution plans.' },
  },
  {
    id: 'reflector',
    type: 'agent',
    position: { x: 510, y: 300 },
    data: { label: 'Cognition Reflector', description: 'Extracts facts and lessons from raw interaction traces.' },
  },
  {
    id: 'codebuild',
    type: 'infra',
    position: { x: 50, y: 450 },
    data: { 
        iconType: 'Terminal', 
        label: 'AWS CodeBuild', 
        description: 'Execution environment for "sst deploy" and automated tests.' 
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: 'superclaw', target: 'bus', sourceHandle: 'bottom', animated: true, style: { stroke: '#00ffa3' } },
  { id: 'e-mem', source: 'superclaw', target: 'memory', sourceHandle: 'left', animated: true, style: { stroke: '#00e0ff' } },
  { id: 'e-bus-coder', source: 'bus', target: 'coder', sourceHandle: 'out-left', markerEnd: { type: MarkerType.ArrowClosed, color: '#00ffa3' } },
  { id: 'e-bus-planner', source: 'bus', target: 'planner', sourceHandle: 'out', markerEnd: { type: MarkerType.ArrowClosed, color: '#00ffa3' } },
  { id: 'e-bus-reflector', source: 'bus', target: 'reflector', sourceHandle: 'out-right', markerEnd: { type: MarkerType.ArrowClosed, color: '#00ffa3' } },
  { id: 'e-coder-build', source: 'coder', target: 'codebuild', animated: true },
];

export default function Flow() {
  const nodes = useMemo(() => initialNodes, []);
  const edges = useMemo(() => initialEdges, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
      >
        <Background color="#333" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
