'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  MessageSquare,
  Wrench,
  CheckCircle,
  ShieldAlert,
  Zap,
  HelpCircle,
  Pause,
  Play,
  Layers,
  GitBranch,
  Shield,
  Cpu,
} from 'lucide-react';
import { TRACE_TYPES } from '@claw/core/lib/constants';

// --- Custom Node Components ---

export const TriggerNode = ({ data }: { data: { label: string; onClick?: () => void } }) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-2 shadow-md rounded-md bg-[#1a1a1a] border-2 border-cyber-green text-white min-w-[150px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <div className="flex items-center border-b border-white/10 pb-1 mb-2">
      <Zap size={14} className="text-cyber-green mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-cyber-green/80">Trigger</span>
    </div>
    <div className="text-[11px] font-mono line-clamp-2 text-white/70 italic">
      &quot;{data.label}&quot;
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-cyber-green border-none"
    />
  </div>
);

export const LLMNode = ({
  data,
}: {
  data: { type: string; agentId?: string; label?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#0f172a] border border-cyber-blue text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-cyber-blue border-none" />
    <div className="flex items-center mb-1">
      <MessageSquare size={14} className="text-cyber-blue mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-cyber-blue/80 uppercase">
        {data.type === TRACE_TYPES.LLM_CALL ? 'Agent Request' : 'Agent Response'}
      </span>
    </div>
    {data.agentId && (
      <div className="text-[9px] font-mono text-cyber-blue/60 mb-2 font-bold uppercase tracking-tighter">
        Node: {data.agentId}
      </div>
    )}
    <div className="text-[11px] font-mono text-white/100 leading-tight line-clamp-2">
      {data.label ?? 'Reasoning...'}
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-cyber-blue border-none"
    />
  </div>
);

export const ToolNode = ({
  data,
}: {
  data: { agentId?: string; toolName: string; status?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#1e1b1e] border border-yellow-500/50 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-yellow-500 border-none" />
    <div className="flex items-center mb-1">
      <Wrench size={14} className="text-yellow-500 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-yellow-500/80">
        Tool Execution
      </span>
    </div>
    {data.agentId && (
      <div className="text-[9px] font-mono text-yellow-500/50 mb-2 font-bold uppercase tracking-tighter">
        Owner: {data.agentId}
      </div>
    )}
    <div className="text-[11px] font-mono text-white/100 font-bold mb-1">{data.toolName}</div>
    <div className="text-[9px] font-mono text-white/60 truncate italic">
      {data.status ?? 'Executing...'}
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-yellow-500 border-none"
    />
  </div>
);

export const ErrorNode = ({ data }: { data: { label: string; onClick?: () => void } }) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-red-500/10 border-2 border-red-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-red-500 border-none" />
    <div className="flex items-center mb-2">
      <ShieldAlert size={14} className="text-red-500 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-red-500">Execution error</span>
    </div>
    <div className="text-[11px] font-mono text-white line-clamp-2">{data.label}</div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-red-500 border-none" />
  </div>
);

export const ResultNode = ({ data }: { data: { label: string; onClick?: () => void } }) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-xl rounded-md bg-cyber-green/10 border-2 border-cyber-green text-white min-w-[200px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-cyber-green border-none" />
    <div className="flex items-center mb-2">
      <CheckCircle size={14} className="text-cyber-green mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-cyber-green">Final response</span>
    </div>
    <div className="text-[11px] font-mono text-white line-clamp-3">{data.label}</div>
  </div>
);

export const ClarificationNode = ({
  data,
}: {
  data: { agentId?: string; question?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#2d1f3d] border-2 border-purple-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-purple-500 border-none" />
    <div className="flex items-center mb-1">
      <HelpCircle size={14} className="text-purple-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-purple-400/80">
        Clarification Request
      </span>
    </div>
    {data.agentId && (
      <div className="text-[9px] font-mono text-purple-400/60 mb-2 font-bold uppercase tracking-tighter">
        From: {data.agentId}
      </div>
    )}
    <div className="text-[11px] font-mono text-white/90 leading-tight line-clamp-2 italic">
      &quot;{data.question ?? 'Needs clarification'}&quot;
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-purple-500 border-none"
    />
  </div>
);

export const WaitingNode = ({
  data,
}: {
  data: { agentId?: string; reason?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#1a2a1a] border-2 border-yellow-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-yellow-500 border-none" />
    <div className="flex items-center mb-1">
      <Pause size={14} className="text-yellow-400 mr-2 animate-pulse" />
      <span className="text-[10px] font-bold tracking-widest text-yellow-400/80">Waiting</span>
    </div>
    {data.agentId && (
      <div className="text-[9px] font-mono text-yellow-400/60 mb-2 font-bold uppercase tracking-tighter">
        Agent: {data.agentId}
      </div>
    )}
    <div className="text-[11px] font-mono text-white/70 leading-tight line-clamp-2">
      {data.reason ?? 'Waiting for input...'}
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-yellow-500 border-none"
    />
  </div>
);

export const BarrierNode = ({
  data,
}: {
  data: { taskCount?: number; status?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#1f1a2d] border-2 border-violet-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-violet-500 border-none" />
    <div className="flex items-center mb-1">
      <Layers size={14} className="text-violet-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-violet-400/80">
        Parallel Barrier
      </span>
    </div>
    <div className="text-[11px] font-mono text-white/90 leading-tight">
      {data.taskCount ? `Waiting for ${data.taskCount} sub-agents` : 'Aggregating results'}
    </div>
    <div className="text-[9px] font-mono text-violet-400/60 mt-1">
      {data.status ?? 'waiting_for_sub_agents'}
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-violet-500 border-none"
    />
  </div>
);

export const CouncilNode = ({
  data,
}: {
  data: { reviewType?: string; status?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#2d1a1a] border-2 border-red-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-red-500 border-none" />
    <div className="flex items-center mb-1">
      <Shield size={14} className="text-red-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-red-400/80">Council Review</span>
    </div>
    <div className="text-[11px] font-mono text-white/90 leading-tight">
      {data.reviewType ?? 'Peer review in progress'}
    </div>
    <div className="text-[9px] font-mono text-red-400/60 mt-1">{data.status ?? 'reviewing'}</div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-red-500 border-none" />
  </div>
);

export const ContinuationNode = ({
  data,
}: {
  data: { direction?: string; initiatorId?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#0f2a2a] border-2 border-teal-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-teal-500 border-none" />
    <div className="flex items-center mb-1">
      <GitBranch size={14} className="text-teal-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-teal-400/80">Continuation</span>
    </div>
    <div className="text-[11px] font-mono text-white/90 leading-tight">
      {data.direction === 'to_initiator' ? 'Result routed to initiator' : 'Resuming agent'}
    </div>
    {data.initiatorId && (
      <div className="text-[9px] font-mono text-teal-400/60 mt-1">
        Initiator: {data.initiatorId}
      </div>
    )}
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-teal-500 border-none" />
  </div>
);

export const CircuitBreakerNode = ({
  data,
}: {
  data: { previousState?: string; newState?: string; reason?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#2a1f0f] border-2 border-orange-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-orange-500 border-none" />
    <div className="flex items-center mb-1">
      <Cpu size={14} className="text-orange-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-orange-400/80">
        Circuit Breaker
      </span>
    </div>
    <div className="text-[11px] font-mono text-white/90 leading-tight">
      {data.previousState} → {data.newState}
    </div>
    <div className="text-[9px] font-mono text-orange-400/60 mt-1 line-clamp-2">
      {data.reason ?? 'State change'}
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-orange-500 border-none"
    />
  </div>
);

export const CancellationNode = ({
  data,
}: {
  data: { taskId?: string; reason?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#2a0f0f] border-2 border-rose-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-rose-500 border-none" />
    <div className="flex items-center mb-1">
      <ShieldAlert size={14} className="text-rose-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-rose-400/80">Task Cancelled</span>
    </div>
    <div className="text-[11px] font-mono text-white/90 leading-tight">
      {data.taskId ? `Task: ${data.taskId.slice(0, 8)}` : 'Task terminated'}
    </div>
    <div className="text-[9px] font-mono text-rose-400/60 mt-1 line-clamp-2">
      {data.reason ?? 'Cancelled'}
    </div>
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-rose-500 border-none" />
  </div>
);

export const ResumedNode = ({
  data,
}: {
  data: { agentId?: string; reason?: string; onClick?: () => void };
}) => (
  <div
    onClick={() => data.onClick && data.onClick()}
    className="px-4 py-3 shadow-lg rounded-md bg-[#0f2a1a] border-2 border-emerald-500 text-white min-w-[180px] max-w-[350px] cursor-pointer hover:scale-105 transition-transform"
  >
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-emerald-500 border-none" />
    <div className="flex items-center mb-1">
      <Play size={14} className="text-emerald-400 mr-2" />
      <span className="text-[10px] font-bold tracking-widest text-emerald-400/80">Resumed</span>
    </div>
    {data.agentId && (
      <div className="text-[9px] font-mono text-emerald-400/60 mb-1 font-bold uppercase tracking-tighter">
        Agent: {data.agentId}
      </div>
    )}
    <div className="text-[11px] font-mono text-white/70 leading-tight line-clamp-2">
      {data.reason ?? 'Agent resumed execution'}
    </div>
    <Handle
      type="source"
      position={Position.Bottom}
      className="w-2 h-2 !bg-emerald-500 border-none"
    />
  </div>
);

/** All custom node types for React Flow registration. */
export const nodeTypes = {
  trigger: TriggerNode,
  llm: LLMNode,
  tool: ToolNode,
  error: ErrorNode,
  result: ResultNode,
  clarification: ClarificationNode,
  waiting: WaitingNode,
  barrier: BarrierNode,
  council: CouncilNode,
  continuation: ContinuationNode,
  circuit_breaker: CircuitBreakerNode,
  cancellation: CancellationNode,
  resumed: ResumedNode,
};
