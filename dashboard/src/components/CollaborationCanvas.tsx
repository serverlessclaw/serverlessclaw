'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Node,
  Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Zap,
  RefreshCw,
  Plus,
  Minus,
  Maximize,
  Lock,
  User,
} from 'lucide-react';

import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';

import { 
  TaskNodeData, 
  HandoffData 
} from '@/lib/collaboration-utils';
import { nodeTypes } from '@/components/CollaborationNodes';
import { HandoffPanel } from '@/components/HandoffPanel';

export default function CollaborationCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [isHumanActive, setIsHumanActive] = useState(false);
  const [handoffData] = useState<HandoffData | null>(null);
  const [handoffResponse, setHandoffResponse] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const handoffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchActiveTasks = useCallback(async () => {
    try {
      const response = await fetch('/api/collaboration');
      const data = await response.json();

      if (!data.activeDispatches || data.activeDispatches.length === 0) {
        setNodes([
          {
            id: 'empty',
            type: 'dagStatus',
            position: { x: 300, y: 200 },
            data: { completed: 0, failed: 0, pending: 0, ready: 0, total: 0 },
          },
        ]);
        setEdges([]);
        setLoading(false);
        return;
      }

      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      data.activeDispatches.forEach(
        (
          dispatch: {
            traceId: string;
            initiatorId?: string;
            initialQuery?: string;
            sessionId?: string;
            aggregationType?: string;
            tasks: TaskNodeData[];
            dagState?: {
              nodes: Record<
                string,
                {
                  status: string;
                  task: { taskId: string; agentId: string; task: string; dependsOn?: string[] };
                }
              >;
              completedTasks: string[];
              failedTasks: string[];
            };
          },
          dispatchIndex: number
        ) => {
          const offsetX = dispatchIndex * 600;
          const initiatorId = `initiator-${dispatch.traceId}`;
          
          newNodes.push({
            id: initiatorId,
            type: 'initiatorNode',
            position: { x: offsetX + 150, y: -150 },
            data: {
              initiatorId: dispatch.initiatorId,
              sessionId: dispatch.sessionId,
              traceId: dispatch.traceId,
              initialQuery: dispatch.initialQuery,
            },
          });

          const completedCount = dispatch.dagState?.completedTasks?.length ?? 0;
          const failedCount = dispatch.dagState?.failedTasks?.length ?? 0;
          const totalTasks = dispatch.tasks.length;
          const pendingCount = dispatch.tasks.filter((t: TaskNodeData) => t.status === 'pending').length;
          const readyCount = dispatch.tasks.filter((t: TaskNodeData) => t.status === 'ready' || t.status === 'running').length;

          const dagNodeId = `dag-${dispatch.traceId}`;
          newNodes.push({
            id: dagNodeId,
            type: 'dagStatus',
            position: { x: offsetX + 150, y: 0 },
            data: {
              completed: completedCount,
              failed: failedCount,
              pending: pendingCount,
              ready: readyCount,
              total: totalTasks,
              traceId: dispatch.traceId,
            },
          });

          newEdges.push({
            id: `edge-${initiatorId}-to-${dagNodeId}`,
            source: initiatorId,
            target: dagNodeId,
            animated: true,
            style: { stroke: '#06b6d4', strokeWidth: 1.5, opacity: 0.6 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4', width: 15, height: 15 },
          });

          const agentTasks = new Map<string, TaskNodeData[]>();
          dispatch.tasks.forEach((t: TaskNodeData) => {
            const aId = t.agentId || 'unassigned';
            if (!agentTasks.has(aId)) agentTasks.set(aId, []);
            agentTasks.get(aId)!.push(t);
          });

          const agents = Array.from(agentTasks.entries());
          const agentCount = agents.length;
          
          agents.forEach(([agentId, tasks], agentIndex) => {
            const agentNodeId = `agent-${dispatch.traceId}-${agentId}`;
            const agentX = offsetX + (agentIndex - (agentCount - 1) / 2) * 260 + 150; 
            
            newNodes.push({
              id: agentNodeId,
              type: 'agentActivity',
              position: { x: agentX, y: 150 },
              data: {
                agentId,
                agentName: agentId,
                activeTasks: tasks.filter(t => t.status === 'running' || t.status === 'pending' || t.status === 'ready'),
                completedCount: tasks.filter(t => t.status === 'completed').length,
                failedCount: tasks.filter(t => t.status === 'failed').length,
              }
            });

            newEdges.push({
              id: `edge-${dagNodeId}-to-${agentNodeId}`,
              source: dagNodeId,
              target: agentNodeId,
              animated: true,
              style: { stroke: '#a855f7', strokeWidth: 1.5, opacity: 0.6 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#a855f7', width: 15, height: 15 },
            });
          });

          let maxTaskY = 150;

          dispatch.tasks.forEach((task: TaskNodeData, taskIndex: number) => {
            const taskNodeId = `task-${dispatch.traceId}-${task.taskId}`;
            const agentId = task.agentId || 'unassigned';
            const agentIndex = agents.findIndex(([aId]) => aId === agentId);
            const taskX = offsetX + (agentIndex - (agentCount - 1) / 2) * 260 + 150;
            const agentTasksList = agents.find(([aId]) => aId === agentId)?.[1] || [];
            const taskIndexInAgent = agentTasksList.findIndex((t) => t.taskId === task.taskId);
            const taskY = 320 + (taskIndexInAgent >= 0 ? taskIndexInAgent : taskIndex) * 110;

            maxTaskY = Math.max(maxTaskY, taskY);

            newNodes.push({
              id: taskNodeId,
              type: 'taskNode',
              position: { x: taskX, y: taskY },
              data: { ...task, label: task.taskId },
            });

            if (task.dependsOn && task.dependsOn.length > 0) {
              task.dependsOn.forEach((depId: string) => {
                const sourceId = `task-${dispatch.traceId}-${depId}`;
                if (newNodes.some((n) => n.id === sourceId)) {
                  newEdges.push({
                    id: `edge-${sourceId}-${taskNodeId}`,
                    source: sourceId,
                    target: taskNodeId,
                    animated: task.status === 'running',
                    style: {
                      stroke: task.status === 'completed' ? '#00d4ff' : task.status === 'failed' ? '#ef4444' : '#ffffff30',
                      strokeWidth: 1.5,
                    },
                    markerEnd: {
                      type: MarkerType.ArrowClosed,
                      color: task.status === 'completed' ? '#00d4ff' : task.status === 'failed' ? '#ef4444' : '#ffffff30',
                      width: 15, height: 15,
                    },
                  });
                }
              });
            } else {
              const agentNodeId = `agent-${dispatch.traceId}-${agentId}`;
              newEdges.push({
                id: `edge-agent-${agentNodeId}-to-${taskNodeId}`,
                source: agentNodeId,
                target: taskNodeId,
                animated: task.status === 'running' || task.status === 'ready',
                style: { stroke: '#a855f7', strokeWidth: 1.5, opacity: 0.3, strokeDasharray: '5,5' },
              });
            }
          });

          const aggregatorNodeId = `aggregator-${dispatch.traceId}`;
          const aggregatorY = maxTaskY + 200;
          newNodes.push({
            id: aggregatorNodeId,
            type: 'aggregatorNode',
            position: { x: offsetX + 150, y: aggregatorY },
            data: {
              type: dispatch.aggregationType || 'COMBINE',
              traceId: dispatch.traceId,
            },
          });

          dispatch.tasks.forEach((task: TaskNodeData) => {
            const taskNodeId = `task-${dispatch.traceId}-${task.taskId}`;
            newEdges.push({
              id: `edge-${taskNodeId}-to-${aggregatorNodeId}`,
              source: taskNodeId,
              target: aggregatorNodeId,
              animated: task.status === 'completed',
              style: { 
                stroke: task.status === 'completed' ? '#d946ef' : '#ffffff30', 
                strokeWidth: 1.5,
                strokeDasharray: task.status === 'completed' ? undefined : '5,5'
              },
              markerEnd: { type: MarkerType.ArrowClosed, color: task.status === 'completed' ? '#d946ef' : '#ffffff30', width: 15, height: 15 },
            });
          });
        }
      );

      setNodes(newNodes);
      setEdges(newEdges);
      setLoading(false);
    } catch (e) {
      console.error('Failed to fetch collaboration data:', e);
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  const handleRealtimeMessage = useCallback(
    (_topic: string, message: RealtimeMessage) => {
      const type = message['detail-type'];
      if (
        type === 'parallel_task_completed' ||
        type === 'task_completed' ||
        type === 'task_failed' ||
        type === 'handoff'
      ) {
        fetchActiveTasks();
      }

      if (type === 'handoff') {
        setIsHumanActive(true);
        if (handoffTimeoutRef.current) clearTimeout(handoffTimeoutRef.current);
        handoffTimeoutRef.current = setTimeout(() => {
          setIsHumanActive(false);
        }, 120000);
      }
    },
    [fetchActiveTasks]
  );

  const { isConnected } = useRealtime({
    topics: ['collaborations/+/signal', 'workspaces/+/signal'],
    onMessage: handleRealtimeMessage,
  });

  useEffect(() => {
    fetchActiveTasks();
  }, [fetchActiveTasks]);

  const handleReset = useCallback(async () => {
    setLoading(true);
    await fetchActiveTasks();
    setTimeout(() => fitView(), 100);
  }, [fetchActiveTasks, fitView]);

  const handleHandoffSubmit = async (approved: boolean) => {
    if (!handoffData) return;
    setSubmittingResponse(true);
    try {
      await fetch('/api/collaboration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: handoffData.taskId,
          response: handoffResponse,
          approved
        }),
      });
      setIsHumanActive(false);
      setHandoffResponse('');
      fetchActiveTasks();
    } catch (err) {
      console.error('Failed to submit handoff response:', err);
    } finally {
      setSubmittingResponse(false);
    }
  };

  return (
    <div className="h-full w-full bg-[#050505] rounded-lg border border-white/5 relative overflow-hidden">
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw size={32} className="text-purple-500 animate-spin" />
            <div className="text-xs font-bold text-purple-500 animate-pulse tracking-[0.3em]">
              SCANNING_AGENT_MATRIX...
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
          <Background color="#222" gap={20} />
        </ReactFlow>
      )}

      {/* Control Panels */}
      <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2">
        <Card variant="solid" padding="none" className="flex flex-col overflow-hidden backdrop-blur-md shadow-2xl">
          <Button variant="ghost" size="sm" onClick={() => zoomIn()} className="border-b border-white/5 p-3 rounded-none text-white/60 hover:text-purple-400" icon={<Plus size={18} />} />
          <Button variant="ghost" size="sm" onClick={() => zoomOut()} className="border-b border-white/5 p-3 rounded-none text-white/60 hover:text-purple-400" icon={<Minus size={18} />} />
          <Button variant="ghost" size="sm" onClick={handleReset} className="p-3 rounded-none text-white/60 hover:text-purple-400" icon={<Maximize size={18} />} />
        </Card>
        <div className="bg-black/80 border border-white/10 rounded-lg p-3 backdrop-blur-md shadow-2xl flex items-center justify-center">
          <Lock size={14} className="text-white/30" />
        </div>
      </div>

      {/* Headers and Status */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div className={`flex items-center gap-2 px-3 py-1 bg-black/80 border ${isConnected ? 'border-cyber-green/30' : 'border-red-500/30'} rounded-full backdrop-blur-md`}>
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-cyber-green animate-pulse' : 'bg-red-500'}`} />
          <Typography variant="caption" weight="bold" className={`${isConnected ? 'text-cyber-green' : 'text-red-500'} uppercase text-[9px]`}>
            {isConnected ? 'Realtime Link Active' : 'Realtime Offline'}
          </Typography>
        </div>
        {isHumanActive && (
          <Badge variant="warning" glow className="flex items-center gap-1.5 px-3">
            <User size={10} /> HUMAN_CONTROL_ACTIVE
          </Badge>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-none">
        <div className="flex items-center gap-2 px-3 py-1 bg-black/80 border border-purple-500/30 rounded-full">
          <Zap size={12} className="text-purple-400 animate-pulse" />
          <Typography variant="caption" weight="bold" className="text-purple-400 uppercase">Live Collaboration Feed</Typography>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchActiveTasks(); }} className="bg-black/80 rounded-full hover:bg-white/5 pointer-events-auto" icon={<RefreshCw size={10} />}>
          <Typography variant="caption" weight="bold" color="white" uppercase>Refresh</Typography>
        </Button>
      </div>

      {isHumanActive && (
        <HandoffPanel
          handoffData={handoffData}
          handoffResponse={handoffResponse}
          setHandoffResponse={setHandoffResponse}
          submittingResponse={submittingResponse}
          onSubmit={handleHandoffSubmit}
        />
      )}
    </div>
  );
}
