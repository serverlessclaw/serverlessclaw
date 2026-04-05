import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { User, Bot } from 'lucide-react';
import {
  AgentActivity,
  TaskNodeData,
  getAgentIcon,
  getStatusIcon,
  getStatusColor,
} from '@/lib/collaboration-utils';

export const nodeTypes = {
  initiatorNode: ({
    data,
  }: {
    data: {
      initiatorId: string;
      sessionId?: string;
      traceId: string;
      initialQuery?: string;
    };
  }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-black border border-cyan-500/50 min-w-[220px] max-w-[300px] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-500/5 rounded-full blur-xl -mr-8 -mt-8"></div>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-sm shrink-0 bg-cyan-500/10 text-cyan-400 mt-1">
            <User size={16} />
          </div>
          <div className="overflow-hidden">
            <div className="text-[10px] font-bold uppercase tracking-tighter truncate text-cyan-400 mb-1">
              {data.initiatorId || 'System'}
            </div>
            {data.initialQuery ? (
              <div className="text-xs font-medium text-white/90 leading-tight italic line-clamp-3">
                &quot;{data.initialQuery}&quot;
              </div>
            ) : (
              <div className="text-sm font-bold text-white/90 break-words leading-tight">
                Root Initiator
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 opacity-40">
              <div className="text-[8px] font-mono uppercase tracking-widest text-white">
                ID: {data.traceId.substring(0, 8)}
              </div>
              {data.sessionId && (
                <div className="text-[8px] font-mono text-white/60 truncate">
                  • {data.sessionId.substring(0, 8)}
                </div>
              )}
            </div>
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-cyan-500/50 !border-none !w-2 !h-2"
        />
      </div>
    </div>
  ),
  aggregatorNode: ({ data }: { data: { type: string; traceId: string } }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-black border border-fuchsia-500/50 min-w-[200px] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-16 h-16 bg-fuchsia-500/5 rounded-full blur-xl -mr-8 -mt-8"></div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-sm shrink-0 bg-fuchsia-500/10 text-fuchsia-400">
            <Bot size={16} />
          </div>
          <div className="overflow-hidden">
            <div className="text-[10px] font-bold uppercase tracking-tighter truncate text-fuchsia-400">
              AGGREGATOR
            </div>
            <div className="text-sm font-bold text-white/90 break-words leading-tight">
              SuperClaw Orchestrator
            </div>
            <div className="text-[9px] text-white/50 mt-1">
              Strategy: {data.type || 'COMBINE'}
            </div>
          </div>
        </div>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-fuchsia-500/50 !border-none !w-2 !h-2"
        />
      </div>
    </div>
  ),
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
    data: {
      completed: number;
      failed: number;
      pending: number;
      ready: number;
      total: number;
      traceId?: string;
    };
  }) => (
    <div className="relative group transition-all duration-300 z-10 hover:z-50">
      <div className="px-4 py-3 shadow-lg rounded-md bg-black border border-cyber-green/30 min-w-[160px] relative overflow-hidden">
        <div className="absolute inset-0 bg-cyber-green/5 animate-pulse"></div>
        <div className="text-[8px] font-bold text-cyber-green uppercase tracking-[0.3em] mb-2 relative z-10">
          DAG STATUS {data.traceId ? `[${data.traceId.substring(0, 8)}]` : ''}
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
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-cyber-green/50 !border-none !w-2 !h-2"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-cyber-green/50 !border-none !w-2 !h-2"
        />
      </div>
    </div>
  ),
};
