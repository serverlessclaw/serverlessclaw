'use client';

import React, { useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  MessageSquare, Wrench, CheckCircle, ShieldAlert, Zap, X, Code, Terminal, Brain, Activity 
} from 'lucide-react';
import { TRACE_TYPES } from '@/lib/constants';

// --- Custom Node Components ---

const TriggerNode = ({ data }: any) => (
  <div 
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-2 shadow-md rounded-md bg-[#1a1a1a] border-2 border-cyber-green text-white min-w-[150px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
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
  <div 
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#0f172a] border border-cyber-blue text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-cyber-blue border-none" />
    <div className="flex items-center mb-2">
      <MessageSquare size={14} className="text-cyber-blue mr-2" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-cyber-blue/80">{data.type === TRACE_TYPES.LLM_CALL ? 'LLM Request' : 'LLM Synthesis'}</span>
    </div>
    <div className="text-[11px] font-mono text-white/100 leading-tight line-clamp-2">
      {data.label || 'Reasoning...'}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-cyber-blue border-none" />
  </div>
);

const ToolNode = ({ data }: any) => (
  <div 
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#1e1b1e] border border-yellow-500/50 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
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

const ErrorNode = ({ data }: any) => (
  <div 
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-red-500/10 border-2 border-red-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-red-500 border-none" />
    <div className="flex items-center mb-2">
      <ShieldAlert size={14} className="text-red-500 mr-2" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">Execution_Error</span>
    </div>
    <div className="text-[11px] font-mono text-white line-clamp-2">
      {data.label}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-red-500 border-none" />
  </div>
);

const ResultNode = ({ data }: any) => (
  <div 
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-xl rounded-md bg-cyber-green/10 border-2 border-cyber-green text-white min-w-[200px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
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
  error: ErrorNode,
  result: ResultNode,
};

// --- Main Path Visualizer Content ---

interface PathVisualizerProps {
  trace: any;
}

function PathVisualizerContent({ trace }: PathVisualizerProps) {
  const [selectedStep, setSelectedStep] = React.useState<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];
    
    // 1. Initial Trigger Node
    initialNodes.push({
      id: 'trigger',
      type: 'trigger',
      data: { 
        label: trace.initialContext?.userText || 'System Task',
        onClick: () => setSelectedStep({ type: 'trigger', content: trace.initialContext })
      },
      position: { x: 250, y: 0 },
    });

    let lastNodeId = 'trigger';
    let currentY = 120;

    // 2. Process Steps
    trace.steps?.forEach((step: any, idx: number) => {
      const nodeId = `step-${idx}`;
      let added = false;
      
      if (step.type === TRACE_TYPES.LLM_CALL) {
        initialNodes.push({
          id: nodeId,
          type: 'llm',
          data: { 
            type: TRACE_TYPES.LLM_CALL,
            label: 'Requesting LLM synthesis.',
            onClick: () => setSelectedStep(step)
          },
          position: { x: 250, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.LLM_RESPONSE) {
        initialNodes.push({
          id: nodeId,
          type: 'llm',
          data: { 
            type: TRACE_TYPES.LLM_RESPONSE,
            label: step.content.content || 'LLM provided a response or tool call.',
            onClick: () => setSelectedStep(step)
          },
          position: { x: 250, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.TOOL_CALL) {
        const tName = step.content.tool || step.content.toolName || 'Unknown';
        initialNodes.push({
          id: nodeId,
          type: 'tool',
          data: { 
            toolName: tName, 
            status: 'Executing Arg: ' + JSON.stringify(step.content.args).substring(0, 20) + '...',
            onClick: () => setSelectedStep(step)
          },
          position: { x: 250, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.TOOL_RESULT) {
         const tName = step.content.tool || step.content.toolName || 'OBSERVATION';
         initialNodes.push({
          id: nodeId,
          type: 'tool',
          data: { 
            toolName: tName, 
            status: 'Result: ' + String(step.content.result).substring(0, 20) + '...',
            onClick: () => setSelectedStep(step)
          },
          position: { x: 250, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.ERROR) {
        initialNodes.push({
          id: nodeId,
          type: 'error',
          data: { 
            label: step.content.errorMessage || 'Unknown Error',
            onClick: () => setSelectedStep(step)
          },
          position: { x: 250, y: currentY },
        });
        added = true;
      }

      if (added) {
        initialEdges.push({
          id: `e-${lastNodeId}-${nodeId}`,
          source: lastNodeId,
          target: nodeId,
          animated: true,
          style: { stroke: '#00ff9f', strokeWidth: 1.5 },
          markerEnd: { 
            type: MarkerType.ArrowClosed, 
            color: '#00ff9f' 
          },
        });

        lastNodeId = nodeId;
        currentY += 140;
      }
    });

    // 3. Final Result Node
    if (trace.finalResponse) {
      const resultId = 'result';
      initialNodes.push({
        id: resultId,
        type: 'result',
        data: { 
          label: trace.finalResponse,
          onClick: () => setSelectedStep({ type: 'result', content: { response: trace.finalResponse } })
        },
        position: { x: 250, y: currentY },
      });

      initialEdges.push({
        id: `e-${lastNodeId}-${resultId}`,
        source: lastNodeId,
        target: resultId,
        animated: false,
        style: { stroke: '#00ff9f', strokeWidth: 2 },
        markerEnd: { 
          type: MarkerType.ArrowClosed, 
          color: '#00ff9f' 
        },
      });
    }

    setNodes(initialNodes);
    setEdges(initialEdges);
    
    // Fit view after state updates
    setTimeout(() => {
      fitView({ padding: 0.2 });
    }, 50);
  }, [trace, setNodes, setEdges, fitView]);

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        colorMode="dark"
      >
        <Background color="#111" gap={20} />
        <Controls showInteractive={false} className="!bg-black/80 !border-white/10 !fill-cyber-green" />
      </ReactFlow>

      {/* --- Step Detail Panel --- */}
      {selectedStep && (
        <div className="absolute top-4 right-4 bottom-4 w-96 bg-[#0a0f1a]/95 border border-cyber-green/30 shadow-[0_0_30px_rgba(0,255,163,0.1)] z-50 rounded-lg flex flex-col animate-in slide-in-from-right-10 duration-300">
          <header className="p-4 border-b border-white/10 flex justify-between items-center bg-black/40 shrink-0">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-cyber-green" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Neural_Inspect</span>
            </div>
            <button 
              onClick={() => setSelectedStep(null)}
              className="text-white/40 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
            <div className="space-y-1">
              <div className="text-[10px] text-cyber-green font-bold uppercase tracking-tighter">Event_Type</div>
              <div className="text-xs font-mono text-white/90 bg-white/5 p-2 rounded border border-white/5 capitalize">
                {selectedStep.type.replace('_', ' ')}
              </div>
            </div>

            {selectedStep.type === TRACE_TYPES.LLM_CALL && selectedStep.content.messages && (
              <div className="space-y-2">
                <div className="text-[10px] text-cyber-blue font-bold uppercase tracking-tighter flex items-center gap-1">
                  <Code size={12} /> PROMPT_CONTEXT
                </div>
                <div className="space-y-2">
                  {selectedStep.content.messages.map((m: any, i: number) => (
                    <div key={i} className="p-2 bg-white/[0.02] border border-white/5 rounded text-[11px] font-mono">
                      <div className="text-cyber-blue/60 mb-1 uppercase text-[9px] font-bold">[{m.role}]</div>
                      <div className="text-white/80 whitespace-pre-wrap leading-relaxed">{m.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedStep.type === TRACE_TYPES.LLM_RESPONSE && (
              <div className="space-y-4">
                 <div className="space-y-2">
                  <div className="text-[10px] text-cyber-green font-bold uppercase tracking-tighter flex items-center gap-1">
                    <MessageSquare size={12} /> LLM_CONTENT
                  </div>
                  <div className="p-2 bg-white/[0.02] border border-white/5 rounded text-[11px] font-mono text-white/80 whitespace-pre-wrap">
                    {selectedStep.content.content || 'No text content provided.'}
                  </div>
                </div>
                {selectedStep.content.tool_calls && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-yellow-500 font-bold uppercase tracking-tighter flex items-center gap-1">
                      <Wrench size={12} /> DELEGATED_TOOLS
                    </div>
                    {selectedStep.content.tool_calls.map((tc: any, i: number) => (
                      <div key={i} className="p-2 bg-yellow-500/5 border border-yellow-500/20 rounded text-[10px] font-mono">
                         <div className="text-yellow-500/80 mb-1 uppercase font-bold">{tc.function.name}</div>
                         <div className="text-white/60 truncate">{tc.function.arguments}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedStep.type === TRACE_TYPES.TOOL_CALL && (
              <div className="space-y-2">
                <div className="text-[10px] text-yellow-500 font-bold uppercase tracking-tighter flex items-center gap-1">
                  <Terminal size={12} /> TOOL_INPUT (JSON)
                </div>
                <div className="p-3 bg-black/60 border border-yellow-500/20 rounded text-[11px] font-mono text-yellow-500/90 whitespace-pre-wrap shadow-inner">
                  {JSON.stringify(selectedStep.content.args, null, 2)}
                </div>
              </div>
            )}

            {selectedStep.type === TRACE_TYPES.TOOL_RESULT && (
              <div className="space-y-2">
                <div className="text-[10px] text-cyber-green font-bold uppercase tracking-tighter flex items-center gap-1">
                  <CheckCircle size={12} /> TOOL_OUTPUT
                </div>
                <div className="p-3 bg-black/60 border border-cyber-green/20 rounded text-[11px] font-mono text-white/90 whitespace-pre-wrap shadow-inner overflow-x-auto">
                  {typeof selectedStep.content.result === 'string' 
                    ? selectedStep.content.result 
                    : JSON.stringify(selectedStep.content.result, null, 2)}
                </div>
              </div>
            )}

            {selectedStep.type === TRACE_TYPES.ERROR && (
              <div className="space-y-2">
                <div className="text-[10px] text-red-500 font-bold uppercase tracking-tighter flex items-center gap-1">
                  <ShieldAlert size={12} /> ERROR_DETAILS
                </div>
                <div className="p-3 bg-red-500/5 border border-red-500/20 rounded text-[11px] font-mono text-red-400 whitespace-pre-wrap shadow-inner">
                  {selectedStep.content.errorMessage}
                </div>
              </div>
            )}

            {selectedStep.type === 'trigger' && (
              <div className="space-y-2">
                <div className="text-[10px] text-white/60 font-bold uppercase tracking-tighter">Initial_Context</div>
                <div className="p-3 bg-white/[0.02] border border-white/10 rounded text-xs text-white/80">
                  {JSON.stringify(selectedStep.content, null, 2)}
                </div>
              </div>
            )}

            {selectedStep.type === 'result' && (
              <div className="space-y-2">
                <div className="text-[10px] text-cyber-green font-bold uppercase tracking-tighter">Transmission_Complete</div>
                <div className="p-3 bg-cyber-green/5 border border-cyber-green/20 rounded text-xs text-white/90 whitespace-pre-wrap">
                  {selectedStep.content.response}
                </div>
              </div>
            )}
          </div>

          <footer className="p-3 border-t border-white/10 bg-black/20 shrink-0 flex justify-between">
             <div className="text-[8px] text-white/20 uppercase tracking-widest font-mono italic">
               ID: {selectedStep.stepId?.substring(0,8) || 'N/A'}
             </div>
             <div className="text-[8px] text-white/20 uppercase tracking-widest font-mono italic">
               {selectedStep.timestamp ? new Date(selectedStep.timestamp).toLocaleTimeString() : ''}
             </div>
          </footer>
        </div>
      )}
    </div>
  );
}

export default function PathVisualizer(props: PathVisualizerProps) {
  return (
    <ReactFlowProvider>
      <PathVisualizerContent {...props} />
    </ReactFlowProvider>
  );
}
