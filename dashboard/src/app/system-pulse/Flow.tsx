'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
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
  Settings2, RefreshCw, Radio, Info
} from 'lucide-react';

const nodeTypes = {
  agent: ({ data }: any) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-black border border-cyber-green/50 min-w-[180px] max-w-[240px] relative overflow-hidden">
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
        <p className="text-[10px] text-white/80 leading-relaxed italic">{data.description}</p>
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
        <p className="text-[10px] text-white/80 leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
  infra: ({ data }: any) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-2 shadow-lg rounded-md bg-[#0a0a0a] border border-cyber-blue/30 min-w-[150px] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-12 h-12 bg-cyber-blue/5 rounded-full blur-lg -mr-6 -mt-6"></div>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyber-blue/10 rounded-sm text-cyber-blue">
            {data.icon}
          </div>
          <div>
            <div className="text-[10px] font-bold text-cyber-blue uppercase tracking-tighter">
              {data.type || 'INFRA_SPOKE'}
            </div>
            <div className="text-sm font-bold text-white/90">{data.label}</div>
          </div>
        </div>
        <Handle type="target" position={Position.Top} className="!bg-cyber-blue/50" />
        <Handle type="source" position={Position.Bottom} className="!bg-cyber-blue/50" />
      </div>

      {/* Description Tooltip Above on Hover */}
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[220px] bg-[#0a0a0a] border border-cyber-blue/30 p-3 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[100] pointer-events-none after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-[#0a0a0a]">
        <div className="flex items-center gap-2 mb-1">
          <Info size={10} className="text-cyber-blue" />
          <span className="text-[8px] font-bold text-cyber-blue uppercase tracking-widest">Resource_Spec</span>
        </div>
        <p className="text-[10px] text-white/80 leading-relaxed italic">{data.description}</p>
      </div>
    </div>
  ),
};

const getAgentIcon = (id: string) => {
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

export default function SystemPulseFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);

  const fetchBlueprint = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const agents: Record<string, any> = await res.json();
      
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      // 1. Add Infrastructure Core
      newNodes.push({
        id: 'bus',
        type: 'bus',
        position: { x: 400, y: 100 },
        data: { 
          label: 'EventBridge AgentBus',
          description: 'AWS EventBridge. The asynchronous backbone that allows decoupled agents to communicate via event patterns.'
        },
      });

      newNodes.push({
        id: 'memory',
        type: 'infra',
        position: { x: 100, y: 500 },
        data: { 
          label: 'DynamoDB Memory', 
          type: 'DATA_STORE', 
          icon: <Database size={16} />,
          description: 'Single-table DynamoDB. Stores session history, distilled knowledge, tactical lessons, and strategic gaps.'
        },
      });

      newNodes.push({
        id: 'codebuild',
        type: 'infra',
        position: { x: 400, y: 500 },
        data: { 
          label: 'AWS CodeBuild', 
          type: 'COMPUTE', 
          icon: <Terminal size={16} />,
          description: 'Autonomous deployment engine. Runs "sst deploy" in isolated environments to update the system stack.'
        },
      });

      newNodes.push({
        id: 's3',
        type: 'infra',
        position: { x: 700, y: 500 },
        data: { 
          label: 'Staging Bucket', 
          type: 'STORAGE', 
          icon: <Cpu size={16} />,
          description: 'Temporary storage for zipped source code before deployment. Shared between Coder Agent and CodeBuild.'
        },
      });

      // 2. Map Agents
      const agentList = Object.values(agents);
      agentList.forEach((agent, index) => {
        // Dynamic layout spacing
        const xPos = 100 + (index * 220);
        const isMain = agent.id === 'main';
        
        newNodes.push({
          id: agent.id,
          type: 'agent',
          position: { x: isMain ? 425 : xPos, y: isMain ? -50 : 300 },
          data: { 
            label: agent.name, 
            enabled: agent.enabled,
            type: isMain ? 'Logic_Core' : 'Neural_Worker',
            icon: getAgentIcon(agent.id),
            description: getAgentDescription(agent.id)
          },
        });

        // MANDATORY: Every agent is connected to the Bus (Input/Output)
        if (isMain) {
          newEdges.push({
            id: `main-bus`,
            source: 'main',
            target: 'bus',
            animated: agent.enabled,
            label: 'ORCHESTRATE',
            labelStyle: { fill: '#00ffa3', fontSize: 10, fontWeight: 'bold' },
            labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
            labelBgPadding: [0, 0],
            style: { stroke: '#00ffa3', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#00ffa3' }
          });
        } else {
          newEdges.push({
            id: `bus-${agent.id}`,
            source: 'bus',
            target: agent.id,
            animated: agent.enabled,
            label: 'SIGNAL',
            labelStyle: { fill: agent.enabled ? '#f97316' : '#444', fontSize: 8, fontWeight: 'bold' },
            labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
            labelBgPadding: [0, 0],
            style: { stroke: agent.enabled ? '#f97316' : '#444' },
            markerEnd: { type: MarkerType.ArrowClosed, color: agent.enabled ? '#f97316' : '#444' }
          });
        }

        // INFRASTRUCTURE CONNECTIONS
        if (agent.enabled) {
          // Connections based on ID
          if (['strategic-planner', 'cognition-reflector', 'qa', 'main'].includes(agent.id)) {
            newEdges.push({ 
              id: `${agent.id}-mem`, 
              source: agent.id, 
              target: 'memory', 
              style: { stroke: '#00f3ff', strokeDasharray: '5,5', opacity: 0.3 } 
            });
          }

          if (agent.id === 'coder') {
            newEdges.push({ 
              id: 'coder-s3', 
              source: 'coder', 
              target: 's3', 
              label: 'UPLOAD', 
              labelStyle: { fill: '#00f3ff', fontSize: 8, fontWeight: 'bold' }, 
              labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
              labelBgPadding: [0, 0],
              style: { stroke: '#00f3ff' } 
            });
            newEdges.push({ 
              id: 'coder-build', 
              source: 'coder', 
              target: 'codebuild', 
              label: 'TRIGGER', 
              labelStyle: { fill: '#00f3ff', fontSize: 8, fontWeight: 'bold' }, 
              labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
              labelBgPadding: [0, 0],
              style: { stroke: '#00f3ff', strokeDasharray: '2,2' } 
            });
          }
          if (agent.id === 'monitor') {
            newEdges.push({ 
              id: 'monitor-build', 
              source: 'monitor', 
              target: 'codebuild', 
              label: 'WATCH', 
              labelStyle: { fill: '#00f3ff', fontSize: 8, fontWeight: 'bold' }, 
              labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
              labelBgPadding: [0, 0],
              style: { stroke: '#00f3ff' } 
            });
          }
        }
      });

      // Add edge between Infra components
      newEdges.push({
        id: 's3-codebuild',
        source: 's3',
        target: 'codebuild',
        label: 'SOURCE_PULL',
        labelStyle: { fill: '#00f3ff', fontSize: 7, fontWeight: 'bold' },
        labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
        labelBgPadding: [0, 0],
        style: { stroke: '#00f3ff', opacity: 0.4 }
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
            <RefreshCw size={32} className="text-cyber-green animate-spin" />
            <div className="text-xs font-bold text-cyber-green animate-pulse tracking-[0.3em]">SYNCHRONIZING_NEURAL_MAP...</div>
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
          <Controls 
            className="!bg-black !border !border-white/10 !fill-white !rounded-md overflow-hidden"
            style={{ 
              backgroundColor: '#000', 
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '4px' 
            }}
          />
        </ReactFlow>
      )}
      
      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1 bg-black/80 border border-cyber-green/30 rounded-full">
              <Radio size={12} className="text-cyber-green animate-pulse" />
              <span className="text-[10px] font-bold text-cyber-green uppercase tracking-wider">LIVE_ARCHITECTURE_FEED</span>
          </div>
          <button 
            onClick={() => { setLoading(true); fetchBlueprint(); }}
            className="flex items-center gap-2 px-3 py-1 bg-black/80 border border-white/10 rounded-full hover:bg-white/5 transition-colors pointer-events-auto cursor-pointer group"
          >
              <RefreshCw size={10} className="text-white/60 group-hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-bold text-white/60 uppercase">Manual_Resync</span>
          </button>
      </div>
    </div>
  );
}
