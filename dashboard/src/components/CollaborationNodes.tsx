'use client';

import React from 'react';
import { Handle, Position, NodeProps, Node } from '@xyflow/react';
import {
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  User,
  Activity,
  Bot,
  Terminal,
  Paperclip,
  LucideIcon,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import { TaskNodeData } from '@/lib/collaboration-utils';

interface StatusConfigItem {
  color: string;
  bg: string;
  border: string;
  icon: LucideIcon;
  label: string;
  animate?: string;
}

const statusConfig: Record<string, StatusConfigItem> = {
  pending: {
    color: 'text-muted-foreground',
    bg: 'bg-foreground/5',
    border: 'border-border',
    icon: Clock,
    label: 'PENDING',
  },
  ready: {
    color: 'text-cyber-blue',
    bg: 'bg-cyber-blue/10',
    border: 'border-cyber-blue/30',
    icon: Activity,
    label: 'READY',
  },
  running: {
    color: 'text-purple-400',
    bg: 'bg-purple-400/10',
    border: 'border-purple-400/30',
    icon: Loader2,
    label: 'RUNNING',
    animate: 'animate-spin',
  },
  completed: {
    color: 'text-cyber-green',
    bg: 'bg-cyber-green/10',
    border: 'border-cyber-green/30',
    icon: CheckCircle2,
    label: 'COMPLETED',
  },
  failed: {
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: XCircle,
    label: 'FAILED',
  },
};

const NodeContainer: React.FC<{
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}> = ({ children, className, glowColor }) => (
  <div
    className={`px-4 py-3 rounded-lg border-2 backdrop-blur-xl transition-all ${className}`}
    style={
      glowColor
        ? {
            boxShadow: `0 0 20px ${glowColor}`,
          }
        : undefined
    }
  >
    {children}
  </div>
);

type TaskNode = Node<TaskNodeData>;
type DagStatusNode = Node<{ completed: number; total: number; failed: number; ready: number; pending: number }>;
type InitiatorNode = Node<{ initiatorId: string; initialQuery: string }>;
type AggregatorNode = Node<{ type: string }>;
type AgentActivityNode = Node<{ agentId: string; activeTasks: unknown[] }>;

export const nodeTypes = {
  taskNode: ({ data }: NodeProps<TaskNode>) => {
    const config = statusConfig[data.status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <NodeContainer
        className={`${config.bg} ${config.border} min-w-[200px] group hover:scale-105 transition-transform`}
        glowColor={data.status === 'running' ? 'color-mix(in srgb, #a855f7 10%, transparent)' : undefined}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-foreground/20 !border-none !w-1.5 !h-1.5"
        />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Icon size={14} className={`${config.color} ${config.animate || ''}`} />
              <Typography variant="mono" weight="black" className="text-[10px] tracking-widest">
                {data.taskId}
              </Typography>
            </div>
            <span
              className={`text-[8px] font-black px-1.5 py-0.5 rounded ${config.bg} ${config.color} border ${config.border}`}
            >
              {config.label}
            </span>
          </div>
          <Typography variant="body" className="text-[11px] leading-snug line-clamp-2 text-foreground/80">
            {data.task}
          </Typography>
          <div className="mt-1 pt-2 border-t border-border flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Bot size={10} className="text-muted-foreground" />
              <span className="text-[9px] font-bold text-muted-foreground uppercase truncate max-w-[80px]">
                {data.agentId}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {data.attachments && data.attachments.length > 0 && (
                <div className="flex items-center gap-1 text-cyber-blue drop-shadow-[0_0_2px_rgba(6,182,212,0.5)]">
                  <Paperclip size={10} />
                  <span className="text-[9px] font-black">{data.attachments.length}</span>
                </div>
              )}
              {data.latency && (
                <span className="text-[9px] font-mono text-muted-foreground">
                  {data.latency.toFixed(0)}ms
                </span>
              )}
            </div>
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-foreground/20 !border-none !w-1.5 !h-1.5"
        />
      </NodeContainer>
    );
  },

  dagStatus: ({ data }: NodeProps<DagStatusNode>) => (
    <NodeContainer className="bg-background/80 border-border min-w-[180px] shadow-2xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Zap size={16} className="text-cyber-green" />
          <Typography variant="caption" weight="black" className="tracking-widest text-[10px]">
            NEURAL_EXECUTION_FLOW
          </Typography>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col">
            <span className="text-[8px] text-muted-foreground uppercase font-black">Success</span>
            <span className="text-lg font-mono font-black text-cyber-green">
              {data.completed}/{data.total}
            </span>
          </div>
          <div className="flex flex-col items-end text-right">
            <span className="text-[8px] text-muted-foreground uppercase font-black">Active</span>
            <span className="text-lg font-mono font-black text-purple-400">
              {data.ready + (data.total - data.completed - data.failed - data.ready - data.pending)}
            </span>
          </div>
        </div>
        <div className="w-full h-1 bg-foreground/5 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-cyber-green transition-all duration-500"
            style={{ width: `${(data.completed / data.total) * 100}%` }}
          />
          <div
            className="h-full bg-red-500 transition-all duration-500"
            style={{ width: `${(data.failed / data.total) * 100}%` }}
          />
        </div>
      </div>
    </NodeContainer>
  ),

  initiatorNode: ({ data }: NodeProps<InitiatorNode>) => (
    <NodeContainer className="bg-cyber-blue/5 border-cyber-blue/30 min-w-[220px]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <User size={14} className="text-cyber-blue" />
          <Typography variant="mono" weight="black" className="text-[10px] text-cyber-blue tracking-widest uppercase">
            Initiator: {data.initiatorId}
          </Typography>
        </div>
        <div className="p-2 bg-background/40 rounded border border-cyber-blue/10 space-y-2">
          <Typography variant="body" className="text-[10px] italic text-cyber-blue/80 line-clamp-2 leading-tight">
            &ldquo;{(data as Record<string, any>).initialQuery}&rdquo;
          </Typography>
          {(data as Record<string, any>).attachments && (data as Record<string, any>).attachments.length > 0 && (
            <div className="flex items-center gap-1.5 border-t border-cyber-blue/10 pt-1.5">
                <Paperclip size={10} className="text-cyber-blue/50" />
                <span className="text-[9px] font-black text-cyber-blue/50">{(data as Record<string, any>).attachments.length} ATTACHED_FILES</span>
            </div>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-cyber-blue/50 !border-none !w-2 !h-2"
      />
    </NodeContainer>
  ),

  aggregatorNode: ({ data }: NodeProps<AggregatorNode>) => (
    <NodeContainer className="bg-foreground/5 border-border min-w-[150px] flex items-center justify-center py-4">
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-foreground/20 !border-none !w-2 !h-2"
      />
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center border border-border">
          <Terminal size={14} className="text-muted-foreground" />
        </div>
        <Typography variant="mono" weight="black" className="text-[9px] tracking-[0.2em] text-muted-foreground">
          RESULT_AGGREGATOR ({data.type})
        </Typography>
      </div>
    </NodeContainer>
  ),

  agentActivity: ({ data }: NodeProps<AgentActivityNode>) => (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
          (data.activeTasks as unknown[]).length > 0
            ? 'border-purple-400 bg-purple-400/10 animate-pulse shadow-[0_0_15px_color-mix(in srgb, #a855f7 30%, transparent)]'
            : 'border-border bg-foreground/5'
        }`}
      >
        <Bot size={20} className={(data.activeTasks as unknown[]).length > 0 ? 'text-purple-400' : 'text-muted-foreground'} />
      </div>
      <div className="px-2 py-0.5 bg-background border border-border rounded text-[8px] font-black uppercase tracking-widest text-foreground/70">
        {data.agentId}
      </div>
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
  ),
};
