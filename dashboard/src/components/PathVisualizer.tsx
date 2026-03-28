'use client';

import React, { useEffect } from 'react';
import {
  ReactFlow,
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
import { TRACE_TYPES } from '@/lib/constants';
import { Trace, TraceStep } from '@/lib/types/ui';
import { nodeTypes } from '@/components/trace/nodes';
import StepDetailPanel from '@/components/trace/StepDetailPanel';

/**
 * Helper to process trace nodes and steps into React Flow nodes and edges.
 */
function processTraceNodes(
  traceNodes: Trace[],
  initialNodes: Node[],
  initialEdges: Edge[],
  setSelectedStep: (step: TraceStep | { type: string; content: Record<string, unknown> }) => void
) {
  const nodeMap = new Map<string, Trace>();
  traceNodes.forEach((n) => nodeMap.set(n.nodeId, n));

  // Find root node
  const rootTraceNode = traceNodes.find((n) => n.nodeId === 'root') ?? traceNodes[0];
  if (!rootTraceNode) return;

  const processedNodes = new Set<string>();
  const xOffsetMap = new Map<string, number>();

  function renderBranch(traceNode: Trace, startX: number, startY: number, parentStepId?: string): number {
    if (processedNodes.has(traceNode.nodeId)) return startY;
    processedNodes.add(traceNode.nodeId);

    let currentY = startY;
    let lastStepId = parentStepId;

    // 1. Initial Trigger / Entry Node for this branch
    const entryId = `${traceNode.nodeId}-entry`;
    initialNodes.push({
      id: entryId,
      type: 'trigger',
      data: {
        label: traceNode.nodeId === 'root' 
          ? (traceNode.initialContext?.userText || 'System Task')
          : `Delegated to ${traceNode.initialContext?.agentId ?? 'Agent'}`,
        onClick: () => setSelectedStep({ type: 'trigger', content: traceNode.initialContext as Record<string, unknown> })
      },
      position: { x: startX, y: currentY },
    });

    if (lastStepId) {
      initialEdges.push({
        id: `e-${lastStepId}-${entryId}`,
        source: lastStepId,
        target: entryId,
        animated: true,
        style: { stroke: '#f97316', strokeWidth: 2, strokeDasharray: '5,5' },
        label: 'DELEGATE',
        labelStyle: { fill: '#f97316', fontSize: 8, fontWeight: 'bold' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#f97316' },
      });
    }

    lastStepId = entryId;
    currentY += 120;

    // 2. Process Steps
    const agentId = traceNode.initialContext?.agentId || traceNode.nodeId;
    traceNode.steps?.forEach((step: TraceStep, idx: number) => {
      const stepNodeId = `${traceNode.nodeId}-step-${idx}`;
      let added = false;

      if (step.type === TRACE_TYPES.LLM_CALL) {
        initialNodes.push({
          id: stepNodeId,
          type: 'llm',
          data: {
            type: TRACE_TYPES.LLM_CALL,
            label: 'Requesting LLM synthesis.',
            agentId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.LLM_RESPONSE) {
        initialNodes.push({
          id: stepNodeId,
          type: 'llm',
          data: {
            type: TRACE_TYPES.LLM_RESPONSE,
            label: step.content.content ?? 'LLM provided a response or tool call.',
            agentId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.TOOL_CALL) {
        const tName = step.content.tool || step.content.toolName || 'Unknown';
        initialNodes.push({
          id: stepNodeId,
          type: 'tool',
          data: {
            toolName: tName,
            status: 'Executing Arg: ' + JSON.stringify(step.content?.args || {}).substring(0, 20) + '...',
            agentId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;

        // CHECK FOR BRANCHING (dispatchTask)
        if (tName === 'dispatchTask' && step.content.args?.agentId) {
          const targetAgentId = step.content.args.agentId;
          const childNode = traceNodes.find(n => n.parentId === traceNode.nodeId && (n.initialContext?.agentId === targetAgentId || n.nodeId.includes(targetAgentId)));
          if (childNode) {
            const branchOffset = (xOffsetMap.get(traceNode.nodeId) ?? 0) + 350;
            xOffsetMap.set(traceNode.nodeId, branchOffset);
            renderBranch(childNode, startX + branchOffset, currentY, stepNodeId);
          }
        }
      } else if (step.type === TRACE_TYPES.TOOL_RESULT) {
        const tName = step.content.tool || step.content.toolName || 'OBSERVATION';
        initialNodes.push({
          id: stepNodeId,
          type: 'tool',
          data: {
            toolName: tName,
            status: 'Result: ' + String(step.content?.result || '').substring(0, 20) + '...',
            agentId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.ERROR) {
        initialNodes.push({
          id: stepNodeId,
          type: 'error',
          data: {
            label: (step.content?.errorMessage as string) ?? 'Unknown Error',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.CLARIFICATION_REQUEST) {
        initialNodes.push({
          id: stepNodeId,
          type: 'clarification',
          data: {
            agentId: step.content.agentId ?? agentId,
            question: step.content.question ?? 'Needs clarification',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.CLARIFICATION_RESPONSE) {
        initialNodes.push({
          id: stepNodeId,
          type: 'resumed',
          data: {
            agentId: step.content.agentId ?? agentId,
            reason: `Clarification provided: ${String(step.content.answer ?? '').substring(0, 50)}`,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.AGENT_WAITING) {
        initialNodes.push({
          id: stepNodeId,
          type: 'waiting',
          data: {
            agentId: step.content.agentId ?? agentId,
            reason: step.content.reason ?? 'Waiting for input',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.AGENT_RESUMED) {
        initialNodes.push({
          id: stepNodeId,
          type: 'resumed',
          data: {
            agentId: step.content.agentId ?? agentId,
            reason: step.content.reason ?? 'Agent resumed execution',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.PARALLEL_DISPATCH) {
        initialNodes.push({
          id: stepNodeId,
          type: 'barrier',
          data: {
            taskCount: step.content.taskCount,
            status: 'dispatched',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.PARALLEL_BARRIER) {
        initialNodes.push({
          id: stepNodeId,
          type: 'barrier',
          data: {
            taskCount: step.content.taskCount,
            status: step.content.status ?? 'waiting_for_sub_agents',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.PARALLEL_COMPLETED) {
        initialNodes.push({
          id: stepNodeId,
          type: 'barrier',
          data: {
            taskCount: step.content.taskCount,
            status: 'aggregation_complete',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.COUNCIL_REVIEW) {
        initialNodes.push({
          id: stepNodeId,
          type: 'council',
          data: {
            reviewType: step.content.reviewType ?? 'Peer review',
            status: step.content.status ?? 'reviewing',
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.CONTINUATION) {
        initialNodes.push({
          id: stepNodeId,
          type: 'continuation',
          data: {
            direction: step.content.direction,
            initiatorId: step.content.initiatorId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.CIRCUIT_BREAKER) {
        initialNodes.push({
          id: stepNodeId,
          type: 'circuit_breaker',
          data: {
            previousState: step.content.previousState,
            newState: step.content.newState,
            reason: step.content.reason,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.CANCELLATION) {
        initialNodes.push({
          id: stepNodeId,
          type: 'cancellation',
          data: {
            taskId: step.content.taskId,
            reason: step.content.reason,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.MEMORY_OPERATION) {
        initialNodes.push({
          id: stepNodeId,
          type: 'tool',
          data: {
            toolName: `Memory: ${step.content.operation ?? 'store'}`,
            status: step.content.key ? `Key: ${step.content.key}` : 'Memory operation',
            agentId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.REFLECT) {
        initialNodes.push({
          id: stepNodeId,
          type: 'llm',
          data: {
            type: TRACE_TYPES.LLM_RESPONSE,
            label: step.content.reflection ?? 'Agent self-reflection',
            agentId,
            onClick: () => setSelectedStep(step)
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      }

      if (added && lastStepId) {
        initialEdges.push({
          id: `e-${lastStepId}-${stepNodeId}`,
          source: lastStepId,
          target: stepNodeId,
          animated: true,
          style: { stroke: '#00ff9f', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#00ff9f' },
        });

        lastStepId = stepNodeId;
        currentY += 140;
      }
    });

    // 3. Final Result Node
    if (traceNode.finalResponse) {
      const resultId = `${traceNode.nodeId}-result`;
      initialNodes.push({
        id: resultId,
        type: 'result',
        data: {
          label: traceNode.finalResponse,
          onClick: () => setSelectedStep({ type: 'result', content: { response: traceNode.finalResponse } })
        },
        position: { x: startX, y: currentY },
      });

      initialEdges.push({
        id: `e-${lastStepId}-${resultId}`,
        source: lastStepId,
        target: resultId,
        animated: false,
        style: { stroke: '#00ff9f', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#00ff9f' },
      });
      currentY += 140;
    }

    return currentY;
  }

  renderBranch(rootTraceNode, 250, 0);
}

// --- Main Path Visualizer Content ---

interface PathVisualizerProps {
  trace: Trace;
}

function PathVisualizerContent({ trace }: PathVisualizerProps) {
  const [selectedStep, setSelectedStep] = React.useState<TraceStep | { type: string; content: Record<string, unknown> } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];
    
    if (!trace.nodes || trace.nodes.length === 0) {
      const nodesToProcess = [trace];
      processTraceNodes(nodesToProcess, initialNodes, initialEdges, setSelectedStep);
    } else {
      processTraceNodes(trace.nodes, initialNodes, initialEdges, setSelectedStep);
    }

    setNodes(initialNodes);
    setEdges(initialEdges);
    
    setTimeout(() => {
      fitView({ padding: 0.2 });
    }, 100);
  }, [trace, setNodes, setEdges, fitView]);

  return (
    <div className="h-[600px] w-full bg-black/40 rounded-lg border border-white/5 relative group overflow-hidden cyber-border">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
         <div className="text-[10px] text-cyber-green/60 font-mono tracking-widest bg-black/80 px-2 py-1 border border-cyber-green/30">
           Trace visualizer
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

      {selectedStep && (
        <StepDetailPanel 
          selectedStep={selectedStep} 
          onClose={() => setSelectedStep(null)} 
        />
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