'use client';

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  BaseEdge,
  getBezierPath,
  EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MessageSquare, Wrench, CheckCircle, ShieldAlert, Zap } from 'lucide-react';

// --- Custom Node Components ---

const TriggerNode = ({ data }: any) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-[#1a1a1a] border-2 border-cyber-green text-white min-w-[150px]">
    <div className="flex items-center border-b border-white/10 pb-1 mb-2">
      <Zap size={14} className="text-cyber-green mr-2" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-cyber-green/80">Trigger</span>
    </div>
    <div className="text-[11px] font-mono line-clamp-2 text-white/70 italic">
      "{data.label}"
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-cyber-green border-none" />
  </div>
);

const LLMNode = ({ data }: any) => (
  <div className="px-4 py-3 shadow-lg rounded-md bg-[#0f172a] border border-cyber-blue text-white min-w-[180px]">
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-cyber-blue border-none" />
    <div className="flex items-center mb-2">
      <MessageSquare size={14} className="text-cyber-blue mr-2" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-cyber-blue/80">LLM Synthesis</span>
    </div>
    <div className="text-[11px] font-mono text-white/100 leading-tight">
      {data.label || 'Reasoning...'}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-cyber-blue border-none" />
  </div>
);

const ToolNode = ({ data }: any) => (
  <div className="px-4 py-3 shadow-lg rounded-md bg-[#1e1b1e] border border-yellow-500/50 text-white min-w-[180px]">
     <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-yellow-500 border-none" />
    <div className="flex items-center mb-2">
      <Wrench size={14} className="text-yellow-500 mr-2" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-500/80">Tool:: {data.toolName}</span>
    </div>
    <div className="text-[9px] font-mono text-white/100 truncate italic">
      {data.status || 'Executing...'}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-yellow-500 border-none" />
  </div>
);

const ResultNode = ({ data }: any) => (
  <div className="px-4 py-3 shadow-xl rounded-md bg-cyber-green/10 border-2 border-cyber-green text-white min-w-[200px]">
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-cyber-green border-none" />
    <div className="flex items-center mb-2">
      <CheckCircle size={14} className="text-cyber-green mr-2" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-cyber-green">Final Response</span>
    </div>
    <div className="text-[11px] font-mono text-white line-clamp-3">
      {data.label}
    </div>
  </div>
);

const nodeTypes = {
  trigger: TriggerNode,
  llm: LLMNode,
  tool: ToolNode,
  result: ResultNode,
};

// --- Main Path Visualizer ---

interface PathVisualizerProps {
  trace: any;
}

export default function PathVisualizer({ trace }: PathVisualizerProps) {
  const { nodes, edges } = useMemo(() => {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];
    
    // 1. Initial Trigger Node
    initialNodes.push({
      id: 'trigger',
      type: 'trigger',
      data: { label: trace.initialContext?.userText || 'System Task' },
      position: { x: 250, y: 0 },
    });

    let lastNodeId = 'trigger';
    let currentY = 120;

    // 2. Process Steps
    trace.steps?.forEach((step: any, idx: number) => {
      const nodeId = `step-${idx}`;
      
      if (step.type === 'llm_call') {
        initialNodes.push({
          id: nodeId,
          type: 'llm',
          data: { label: 'Synthesizing knowledge and planning next steps.' },
          position: { x: 250, y: currentY },
        });
      } else if (step.type === 'tool_call') {
        initialNodes.push({
          id: nodeId,
          type: 'tool',
          data: { toolName: step.content.toolName, status: 'Active' },
          position: { x: 250, y: currentY },
        });
      } else if (step.type === 'tool_result') {
         initialNodes.push({
          id: nodeId,
          type: 'tool',
          data: { toolName: 'OBSERVATION', status: 'Completed' },
          position: { x: 250, y: currentY },
        });
      } else {
        return; // Skip unknown or redundant steps in graph for now
      }

      initialEdges.push({
        id: `e-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
        animated: true,
        style: { stroke: '#00ff9f', strokeWidth: 1.5 },
      });

      lastNodeId = nodeId;
      currentY += 140;
    });

    // 3. Final Result Node
    if (trace.finalResponse) {
      const resultId = 'result';
      initialNodes.push({
        id: resultId,
        type: 'result',
        data: { label: trace.finalResponse },
        position: { x: 250, y: currentY },
      });

      initialEdges.push({
        id: `e-${lastNodeId}-${resultId}`,
        source: lastNodeId,
        target: resultId,
        animated: false,
        style: { stroke: '#00ff9f', strokeWidth: 2 },
      });
    }

    return { nodes: initialNodes, edges: initialEdges };
  }, [trace]);

  return (
    <div className="h-[600px] w-full bg-black/40 rounded-lg border border-white/5 relative group overflow-hidden cyber-border">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
         <div className="text-[10px] text-cyber-green/60 font-mono tracking-widest uppercase bg-black/80 px-2 py-1 border border-cyber-green/30">
           Neural_Path_Visualizer
         </div>
      </div>
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        colorMode="dark"
      >
        <Background color="#111" gap={20} />
        <Controls showInteractive={false} className="!bg-black/80 !border-white/10 !fill-cyber-green" />
      </ReactFlow>
    </div>
  );
}
