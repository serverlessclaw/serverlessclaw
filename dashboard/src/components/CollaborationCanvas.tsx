'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Zap,
  RefreshCw,
  Plus,
  Minus,
  Maximize,
  Lock,
  Bot,
  Code,
  Brain,
  Search,
  FlaskConical,
  Settings2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader,
  User,
  Send,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { useReactFlow, ReactFlowProvider } from '@xyflow/react';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';

interface TaskNodeData {
  label: string;
  taskId: string;
  agentId: string;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
  task: string;
  dependsOn?: string[];
  result?: string;
  startedAt?: number;
  completedAt?: number;
}

interface AgentActivity {
  agentId: string;
  agentName: string;
  activeTasks: TaskNodeData[];
  completedCount: number;
  failedCount: number;
}

const getAgentIcon = (agentId: string) => {
  if (agentId === 'superclaw') return <Bot size={16} />;
  if (agentId === 'coder') return <Code size={16} />;
  if (agentId === 'strategic-planner') return <Brain size={16} />;
  if (agentId === 'cognition-reflector') return <Search size={16} />;
  if (agentId === 'qa') return <FlaskConical size={16} />;
  return <Settings2 size={16} />;
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'running':
      return <Loader size={12} className="animate-spin text-cyber-green" />;
    case 'completed':
      return <CheckCircle size={12} className="text-cyber-blue" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'pending':
      return <Clock size={12} className="text-yellow-500" />;
    case 'ready':
      return <AlertCircle size={12} className="text-orange-500" />;
    default:
      return <Clock size={12} className="text-white/40" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'running':
      return 'border-cyber-green/50 bg-cyber-green/5';
    case 'completed':
      return 'border-cyber-blue/50 bg-cyber-blue/5';
    case 'failed':
      return 'border-red-500/50 bg-red-500/5';
    case 'pending':
      return 'border-yellow-500/50 bg-yellow-500/5';
    case 'ready':
      return 'border-orange-500/50 bg-orange-500/5';
    default:
      return 'border-white/20 bg-white/5';
  }
};

const nodeTypes = {
  agentActivity: ({ data }: { data: AgentActivity }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-black border border-purple-500/50 min-w-[200px] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-16 h-16 bg-purple-500/5 rounded-full blur-xl -mr-8 -mt-8"></div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-sm shrink-0 bg-purple-500/10 text-purple-400">
            {getAgentIcon(data.agentId)}
          </div>
          <div className="overflow-hidden">
            <div className="text-[10px] font-bold uppercase tracking-tighter truncate text-purple-400">
              NEURAL_WORKER
            </div>
            <div className="text-sm font-bold text-white/90 break-words leading-tight">
              {data.agentName}
            </div>
            <div className="text-[9px] text-white/50 mt-1">
              {data.activeTasks.length} active • {data.completedCount} done • {data.failedCount}{' '}
              failed
            </div>
          </div>
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-purple-500/50 !border-none !w-2 !h-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-purple-500/50 !border-none !w-2 !h-2"
        />
      </div>
    </div>
  ),
  taskNode: ({ data }: { data: TaskNodeData }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div
        className={`px-3 py-2 shadow-lg rounded-md border min-w-[180px] max-w-[220px] relative overflow-hidden ${getStatusColor(data.status)}`}
      >
        <div className="flex items-center gap-2">
          {getStatusIcon(data.status)}
          <div className="overflow-hidden flex-1">
            <div className="text-[9px] font-bold uppercase tracking-tighter truncate text-white/60">
              {data.taskId}
            </div>
            <div className="text-xs font-medium text-white/90 break-words leading-tight truncate">
              {data.task.length > 40 ? data.task.substring(0, 40) + '...' : data.task}
            </div>
          </div>
        </div>
        {data.dependsOn && data.dependsOn.length > 0 && (
          <div className="mt-1 text-[8px] text-white/40">
            Depends on: {data.dependsOn.join(', ')}
          </div>
        )}
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-white/30 !border-none !w-2 !h-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-white/30 !border-none !w-2 !h-2"
        />
      </div>
    </div>
  ),
  dagStatus: ({
    data,
  }: {
    data: { completed: number; failed: number; pending: number; ready: number; total: number };
  }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-black border border-cyber-green/30 min-w-[160px] relative overflow-hidden">
        <div className="absolute inset-0 bg-cyber-green/5 animate-pulse"></div>
        <div className="text-[8px] font-bold text-cyber-green uppercase tracking-[0.3em] mb-2 relative z-10">
          DAG STATUS
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] relative z-10">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyber-green"></div>
            <span className="text-white/70">Running:</span>
            <span className="text-cyber-green font-bold">{data.ready}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
            <span className="text-white/70">Pending:</span>
            <span className="text-yellow-500 font-bold">{data.pending}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyber-blue"></div>
            <span className="text-white/70">Done:</span>
            <span className="text-cyber-blue font-bold">{data.completed}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span className="text-white/70">Failed:</span>
            <span className="text-red-500 font-bold">{data.failed}</span>
          </div>
        </div>
        <div className="mt-2 text-[9px] text-white/50 relative z-10">Total: {data.total} tasks</div>
      </div>
    </div>
  ),
};

interface HandoffData {
  taskId: string;
  agentId: string;
  reason: string;
  context: string;
  timestamp: number;
}

export function CollaborationCanvasContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [isHumanActive, setIsHumanActive] = useState(false);
  const [handoffData, setHandoffData] = useState<HandoffData | null>(null);
  const [handoffResponse, setHandoffResponse] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const handoffTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchActiveTasks = useCallback(async () => {
    try {
      // Fetch active parallel dispatches
      const response = await fetch('/api/collaboration');
      const data = await response.json();

      if (!data.activeDispatches || data.activeDispatches.length === 0) {
        // Show empty state
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

      // Process each active dispatch
      data.activeDispatches.forEach(
        (
          dispatch: {
            traceId: string;
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
          const offsetX = dispatchIndex * 500;

          // Add DAG status node
          const completedCount = dispatch.dagState?.completedTasks?.length ?? 0;
          const failedCount = dispatch.dagState?.failedTasks?.length ?? 0;
          const totalTasks = dispatch.tasks.length;
          const pendingCount = dispatch.tasks.filter(
            (t: TaskNodeData) => t.status === 'pending'
          ).length;
          const readyCount = dispatch.tasks.filter(
            (t: TaskNodeData) => t.status === 'ready' || t.status === 'running'
          ).length;

          newNodes.push({
            id: `dag-${dispatch.traceId}`,
            type: 'dagStatus',
            position: { x: offsetX, y: 0 },
            data: {
              completed: completedCount,
              failed: failedCount,
              pending: pendingCount,
              ready: readyCount,
              total: totalTasks,
            },
          });

          // Add task nodes
          dispatch.tasks.forEach((task: TaskNodeData, taskIndex: number) => {
            const taskNodeId = `task-${dispatch.traceId}-${task.taskId}`;

            newNodes.push({
              id: taskNodeId,
              type: 'taskNode',
              position: {
                x: offsetX + (taskIndex % 3) * 220,
                y: 100 + Math.floor(taskIndex / 3) * 100,
              },
              data: {
                ...task,
                label: task.taskId,
              },
            });

            // Add dependency edges
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
                      stroke:
                        task.status === 'completed'
                          ? '#00d4ff'
                          : task.status === 'failed'
                            ? '#ef4444'
                            : '#ffffff30',
                      strokeWidth: 1.5,
                    },
                    markerEnd: {
                      type: MarkerType.ArrowClosed,
                      color:
                        task.status === 'completed'
                          ? '#00d4ff'
                          : task.status === 'failed'
                            ? '#ef4444'
                            : '#ffffff30',
                      width: 15,
                      height: 15,
                    },
                  });
                }
              });
            }
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

  // Real-time message handler
  const handleRealtimeMessage = useCallback(
    (_topic: string, message: RealtimeMessage) => {
      const type = message['detail-type'];

      // Refresh task state on any relevant completion/update
      if (
        type === 'parallel_task_completed' ||
        type === 'task_completed' ||
        type === 'task_failed' ||
        type === 'handoff'
      ) {
        console.log(`[Realtime] Triggering refresh due to: ${type}`);
        fetchActiveTasks();
      }

      // Handle handoff visual state
      if (type === 'handoff') {
        setIsHumanActive(true);
        if (handoffTimeoutRef.current) clearTimeout(handoffTimeoutRef.current);
        handoffTimeoutRef.current = setTimeout(() => {
          setIsHumanActive(false);
        }, 120000); // Match core handoff TTL
      }
    },
    [fetchActiveTasks]
  );

  // Use Realtime Hook
  const { isConnected } = useRealtime({
    topics: ['collaborations/+/signal', 'workspaces/+/signal'],
    onMessage: handleRealtimeMessage,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActiveTasks();
  }, [fetchActiveTasks]);

  const handleReset = useCallback(async () => {
    setLoading(true);
    await fetchActiveTasks();
    setTimeout(() => fitView(), 100);
  }, [fetchActiveTasks, fitView]);

  return (
    <div className="h-full w-full bg-[#050505] rounded-lg border border-white/5 relative overflow-hidden">
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw size={32} className={`text-purple-500 animate-spin`} />
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

      {/* Custom Controls */}
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
            className="border-b border-white/5 p-3 rounded-none text-white/60 hover:text-purple-400"
            title="Zoom In"
            icon={<Plus size={18} className="group-active:scale-90 transition-transform" />}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => zoomOut()}
            className="border-b border-white/5 p-3 rounded-none text-white/60 hover:text-purple-400"
            title="Zoom Out"
            icon={<Minus size={18} className="group-active:scale-90 transition-transform" />}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="p-3 rounded-none text-white/60 hover:text-purple-400"
            title="Reset View"
            icon={<Maximize size={18} className="group-active:scale-90 transition-transform" />}
          />
        </Card>

        <div className="bg-black/80 border border-white/10 rounded-lg p-3 backdrop-blur-md shadow-2xl flex items-center justify-center">
          <Lock size={14} className="text-white/30" />
        </div>
      </div>

      {/* Status Bar */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div
          className={`flex items-center gap-2 px-3 py-1 bg-black/80 border ${isConnected ? 'border-cyber-green/30' : 'border-red-500/30'} rounded-full backdrop-blur-md`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-cyber-green animate-pulse' : 'bg-red-500'}`}
          />
          <Typography
            variant="caption"
            weight="bold"
            className={`${isConnected ? 'text-cyber-green' : 'text-red-500'} uppercase text-[9px]`}
          >
            {isConnected ? 'Realtime Link Active' : 'Realtime Offline'}
          </Typography>
        </div>

        {isHumanActive && (
          <Badge variant="warning" glow className="flex items-center gap-1.5 px-3">
            <User size={10} />
            HUMAN_CONTROL_ACTIVE
          </Badge>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-none">
        <div className="flex items-center gap-2 px-3 py-1 bg-black/80 border border-purple-500/30 rounded-full">
          <Zap size={12} className="text-purple-400 animate-pulse" />
          <Typography variant="caption" weight="bold" className="text-purple-400 uppercase">
            Live Collaboration Feed
          </Typography>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchActiveTasks();
          }}
          className="bg-black/80 rounded-full hover:bg-white/5 group pointer-events-auto"
          icon={
            <RefreshCw
              size={10}
              className="text-white/90 group-hover:rotate-180 transition-transform duration-500"
            />
          }
        >
          <Typography variant="caption" weight="bold" color="white" uppercase>
            Refresh
          </Typography>
        </Button>
      </div>

      {/* Handoff Response Panel */}
      {isHumanActive && (
        <div className="absolute bottom-6 right-6 z-30 w-[360px] bg-[#0a0a0a] border border-orange-500/50 rounded-xl shadow-[0_0_30px_rgba(249,115,22,0.2)] overflow-hidden">
          <div className="px-4 py-3 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-3">
            <div className="p-1.5 bg-orange-500/20 rounded">
              <User size={14} className="text-orange-400" />
            </div>
            <div>
              <Typography
                variant="caption"
                weight="bold"
                className="text-orange-400 uppercase tracking-wider"
              >
                Human Input Required
              </Typography>
              <Typography variant="mono" className="text-[9px] text-white/40 mt-0.5">
                Agent escalated task for review
              </Typography>
            </div>
          </div>

          {handoffData && (
            <div className="p-4 space-y-3">
              <div className="bg-white/5 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Typography variant="mono" className="text-[9px] text-white/40 uppercase">
                    Task ID:
                  </Typography>
                  <Typography variant="mono" className="text-[10px] text-white/80">
                    {handoffData.taskId}
                  </Typography>
                </div>
                <div className="flex items-center gap-2">
                  <Typography variant="mono" className="text-[9px] text-white/40 uppercase">
                    Agent:
                  </Typography>
                  <Typography variant="mono" className="text-[10px] text-white/80">
                    {handoffData.agentId}
                  </Typography>
                </div>
                <div>
                  <Typography variant="mono" className="text-[9px] text-white/40 uppercase mb-1">
                    Reason:
                  </Typography>
                  <Typography variant="body" className="text-[11px] text-white/70 italic">
                    &quot;{handoffData.reason}&quot;
                  </Typography>
                </div>
              </div>

              <div>
                <Typography variant="mono" className="text-[9px] text-white/40 uppercase mb-2">
                  Your Response:
                </Typography>
                <textarea
                  value={handoffResponse}
                  onChange={(e) => setHandoffResponse(e.target.value)}
                  placeholder="Provide guidance or approve/reject the agent's request..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-orange-500/50 resize-none h-20"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHandoffResponse('APPROVE');
                    setSubmittingResponse(true);
                    // Submit approval
                    fetch('/api/chat', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        message: 'APPROVE',
                        metadata: { handoffResponse: true, taskId: handoffData?.taskId },
                      }),
                    }).finally(() => {
                      setSubmittingResponse(false);
                      setIsHumanActive(false);
                      setHandoffData(null);
                      setHandoffResponse('');
                    });
                  }}
                  disabled={submittingResponse}
                  className="flex-1 border-cyber-green/30 text-cyber-green hover:bg-cyber-green/10"
                  icon={<ThumbsUp size={14} />}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!handoffResponse.trim()) return;
                    setSubmittingResponse(true);
                    fetch('/api/chat', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        message: handoffResponse,
                        metadata: { handoffResponse: true, taskId: handoffData?.taskId },
                      }),
                    }).finally(() => {
                      setSubmittingResponse(false);
                      setIsHumanActive(false);
                      setHandoffData(null);
                      setHandoffResponse('');
                    });
                  }}
                  disabled={submittingResponse || !handoffResponse.trim()}
                  className="flex-1"
                  icon={<Send size={14} />}
                >
                  Send
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setHandoffResponse('REJECT');
                    setSubmittingResponse(true);
                    fetch('/api/chat', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        message: 'REJECT',
                        metadata: { handoffResponse: true, taskId: handoffData?.taskId },
                      }),
                    }).finally(() => {
                      setSubmittingResponse(false);
                      setIsHumanActive(false);
                      setHandoffData(null);
                      setHandoffResponse('');
                    });
                  }}
                  disabled={submittingResponse}
                  icon={<ThumbsDown size={14} />}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}

          {!handoffData && (
            <div className="p-4 text-center">
              <Typography variant="body" color="muted" className="text-[11px]">
                Waiting for handoff details...
              </Typography>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CollaborationCanvas() {
  return (
    <ReactFlowProvider>
      <CollaborationCanvasContent />
    </ReactFlowProvider>
  );
}
