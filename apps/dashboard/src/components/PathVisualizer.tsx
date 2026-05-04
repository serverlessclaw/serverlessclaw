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
import { TRACE_TYPES } from '@claw/core/lib/constants';
import {
  Trace,
  TraceStep,
  AgentStateContent,
  ParallelDispatchContent,
  ParallelBarrierContent,
  GenericContent,
} from '@/lib/types/ui';
import { nodeTypes } from '@/components/Trace/nodes';
import StepDetailPanel from '@/components/Trace/StepDetailPanel';

/**
 * Configuration for the Path Visualizer geometry and styling.
 * Resolves magic numbers and colors for better AI readiness.
 */
const VISUALIZER_CONFIG = {
  LAYOUT: {
    INITIAL_X: 250,
    INITIAL_Y: 0,
    STEP_Y_OFFSET: 140,
    TRIGGER_Y_OFFSET: 120,
    BRANCH_X_OFFSET: 350,
  },
  COLORS: {
    DELEGATE: '#f97316',
    STEP_CONNECT: '#00ff9f',
    BACKGROUND_GRID: '#111',
  },
  ZOOM: {
    MIN: 0.2,
    MAX: 1.5,
    FIT_PADDING: 0.2,
  },
} as const;

/**
 * Helper to process trace nodes and steps into React Flow nodes and edges.
 * Handles recursive branching for delegated tasks.
 *
 * @param traceNodes List of all trace nodes in the session.
 * @param initialNodes Output array for React Flow nodes.
 * @param initialEdges Output array for React Flow edges.
 * @param setSelectedStep Callback to handle step selection.
 */
function processTraceNodes(
  traceNodes: Trace[],
  initialNodes: Node[],
  initialEdges: Edge[],
  setSelectedStep: (step: TraceStep) => void
) {
  const processedNodes = new Set<string>();
  const xOffsetMap = new Map<string, number>();

  /**
   * Recursively renders a branch of the trace starting from a specific node.
   * @param traceNode The current node to render.
   * @param startX Starting X coordinate.
   * @param startY Starting Y coordinate.
   * @param parentStepId Optional ID of the parent step that triggered this branch.
   * @returns Current Y coordinate after rendering the branch.
   */
  function renderBranch(
    traceNode: Trace,
    startX: number,
    startY: number,
    parentStepId?: string
  ): number {
    if (processedNodes.has(traceNode.nodeId)) return startY;
    processedNodes.add(traceNode.nodeId);

    let currentY = startY;
    let lastStepId = parentStepId;

    // 1. Initial Trigger / Entry Node
    const entryId = `${traceNode.nodeId}-entry`;
    initialNodes.push({
      id: entryId,
      type: 'trigger',
      data: {
        label:
          traceNode.nodeId === 'root'
            ? traceNode.initialContext?.userText || 'System Task'
            : `Delegated to ${traceNode.initialContext?.agentId ?? 'Agent'}`,
        onClick: () =>
          setSelectedStep({
            stepId: entryId,
            timestamp: traceNode.timestamp,
            type: 'trigger',
            content: (traceNode.initialContext as GenericContent) ?? {},
            metadata: {},
          }),
      },
      position: { x: startX, y: currentY },
    });

    if (lastStepId) {
      initialEdges.push({
        id: `e-${lastStepId}-${entryId}`,
        source: lastStepId,
        target: entryId,
        animated: true,
        style: {
          stroke: VISUALIZER_CONFIG.COLORS.DELEGATE,
          strokeWidth: 2,
          strokeDasharray: '5,5',
        },
        label: 'DELEGATE',
        labelStyle: { fill: VISUALIZER_CONFIG.COLORS.DELEGATE, fontSize: 8, fontWeight: 'bold' },
        markerEnd: { type: MarkerType.ArrowClosed, color: VISUALIZER_CONFIG.COLORS.DELEGATE },
      });
    }

    lastStepId = entryId;
    currentY += VISUALIZER_CONFIG.LAYOUT.TRIGGER_Y_OFFSET;

    // 2. Process Steps
    const agentId = traceNode.initialContext?.agentId || traceNode.nodeId;
    traceNode.steps?.forEach((step: TraceStep, idx: number) => {
      const stepNodeId = `${traceNode.nodeId}-step-${idx}`;
      let added = false;

      // Handle different trace step types
      if (step.type === TRACE_TYPES.LLM_CALL) {
        initialNodes.push({
          id: stepNodeId,
          type: 'llm',
          data: {
            type: TRACE_TYPES.LLM_CALL,
            label: 'LLM synthesis request.',
            agentId,
            onClick: () => setSelectedStep(step),
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
            label: step.content.content ?? 'LLM Response.',
            agentId,
            onClick: () => setSelectedStep(step),
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
            status: `Exec: ${JSON.stringify(step.content?.args || {}).substring(0, 20)}...`,
            agentId,
            onClick: () => setSelectedStep(step),
          },
          position: { x: startX, y: currentY },
        });
        added = true;

        // Recursively handle task dispatching/branching
        if (tName === 'dispatchTask' && step.content.args?.agentId) {
          const targetAgentId = String(step.content.args.agentId);
          const childNode = traceNodes.find(
            (n) =>
              n.parentId === traceNode.nodeId &&
              (n.initialContext?.agentId === targetAgentId || n.nodeId.includes(targetAgentId))
          );
          if (childNode) {
            const branchOffset =
              (xOffsetMap.get(traceNode.nodeId) ?? 0) + VISUALIZER_CONFIG.LAYOUT.BRANCH_X_OFFSET;
            xOffsetMap.set(traceNode.nodeId, branchOffset);
            renderBranch(childNode, startX + branchOffset, currentY, stepNodeId);
          }
        }
      } else if (step.type === TRACE_TYPES.TOOL_RESULT) {
        initialNodes.push({
          id: stepNodeId,
          type: 'tool',
          data: {
            toolName: step.content.tool || 'OBSERVATION',
            status: `Res: ${String(step.content?.result || '').substring(0, 20)}...`,
            agentId,
            onClick: () => setSelectedStep(step),
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (step.type === TRACE_TYPES.ERROR) {
        initialNodes.push({
          id: stepNodeId,
          type: 'error',
          data: {
            label: (step.content?.errorMessage as string) ?? 'Process Error',
            onClick: () => setSelectedStep(step),
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
            question: step.content.question ?? 'Needs input',
            onClick: () => setSelectedStep(step),
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (
        step.type === TRACE_TYPES.AGENT_WAITING ||
        step.type === TRACE_TYPES.AGENT_RESUMED ||
        step.type === TRACE_TYPES.CLARIFICATION_RESPONSE
      ) {
        initialNodes.push({
          id: stepNodeId,
          type: step.type === TRACE_TYPES.AGENT_WAITING ? 'waiting' : 'resumed',
          data: {
            agentId: (step.content as AgentStateContent).agentId ?? agentId,
            reason:
              (step.content as AgentStateContent).reason ||
              (step.content as GenericContent).answer ||
              'Status Change',
            onClick: () => setSelectedStep(step),
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else if (
        new Set<string>([
          TRACE_TYPES.PARALLEL_DISPATCH,
          TRACE_TYPES.PARALLEL_BARRIER,
          TRACE_TYPES.PARALLEL_COMPLETED,
        ]).has(step.type)
      ) {
        initialNodes.push({
          id: stepNodeId,
          type: 'barrier',
          data: {
            taskCount: (step.content as ParallelDispatchContent).taskCount,
            status: (step.content as ParallelBarrierContent).status || 'parallel_op',
            onClick: () => setSelectedStep(step),
          },
          position: { x: startX, y: currentY },
        });
        added = true;
      } else {
        // Fallback for other types (council, continuation, circuit_breaker, etc.)
        initialNodes.push({
          id: stepNodeId,
          type: 'llm',
          data: {
            type: step.type,
            label: `Status: ${step.type}`,
            agentId,
            onClick: () => setSelectedStep(step),
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
          style: { stroke: VISUALIZER_CONFIG.COLORS.STEP_CONNECT, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: VISUALIZER_CONFIG.COLORS.STEP_CONNECT },
        });

        lastStepId = stepNodeId;
        currentY += VISUALIZER_CONFIG.LAYOUT.STEP_Y_OFFSET;
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
          onClick: () =>
            setSelectedStep({
              stepId: resultId,
              timestamp: Date.now(),
              type: 'result',
              content: { response: traceNode.finalResponse! },
              metadata: {},
            }),
        },
        position: { x: startX, y: currentY },
      });

      initialEdges.push({
        id: `e-${lastStepId}-${resultId}`,
        source: lastStepId,
        target: resultId,
        animated: false,
        style: { stroke: VISUALIZER_CONFIG.COLORS.STEP_CONNECT, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: VISUALIZER_CONFIG.COLORS.STEP_CONNECT },
      });
      currentY += VISUALIZER_CONFIG.LAYOUT.STEP_Y_OFFSET;
    }

    return currentY;
  }

  const rootNode = traceNodes.find((n) => n.nodeId === 'root') ?? traceNodes[0];
  if (rootNode)
    renderBranch(rootNode, VISUALIZER_CONFIG.LAYOUT.INITIAL_X, VISUALIZER_CONFIG.LAYOUT.INITIAL_Y);
}

interface PathVisualizerProps {
  trace: Trace;
}

/**
 * Internal component for rendering the React Flow canvas.
 */
function PathVisualizerContent({ trace }: PathVisualizerProps) {
  const [selectedStep, setSelectedStep] = React.useState<TraceStep | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];

    const nodesToProcess = !trace.nodes || trace.nodes.length === 0 ? [trace] : trace.nodes;
    processTraceNodes(nodesToProcess, initialNodes, initialEdges, setSelectedStep);

    setNodes(initialNodes);
    setEdges(initialEdges);

    setTimeout(() => {
      fitView({ padding: VISUALIZER_CONFIG.ZOOM.FIT_PADDING });
    }, 100);
  }, [trace, setNodes, setEdges, fitView]);

  return (
    <div
      data-testid="collaboration-canvas"
      className="PathVisualizer h-[600px] w-full bg-background/40 rounded-lg border border-border relative group overflow-hidden cyber-border"
    >
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="text-[10px] text-cyber-green/60 font-mono tracking-widest bg-background/80 px-2 py-1 border border-cyber-green/30">
          TRACE VISUALIZER
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        minZoom={VISUALIZER_CONFIG.ZOOM.MIN}
        maxZoom={VISUALIZER_CONFIG.ZOOM.MAX}
        colorMode="dark"
      >
        <Background color={VISUALIZER_CONFIG.COLORS.BACKGROUND_GRID} gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-background/80 !border-border !fill-cyber-green"
        />
      </ReactFlow>

      {selectedStep && (
        <StepDetailPanel selectedStep={selectedStep} onClose={() => setSelectedStep(null)} />
      )}
    </div>
  );
}

/**
 * Main PathVisualizer component wrapped in a ReactFlowProvider.
 * Visualizes the agent execution path including recursive delegations.
 */
export default function PathVisualizer(props: PathVisualizerProps) {
  return (
    <ReactFlowProvider>
      <PathVisualizerContent {...props} />
    </ReactFlowProvider>
  );
}
