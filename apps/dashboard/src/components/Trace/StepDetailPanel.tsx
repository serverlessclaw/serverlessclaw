'use client';

import React from 'react';
import {
  MessageSquare,
  Wrench,
  CheckCircle,
  ShieldAlert,
  Code,
  Terminal,
  Brain,
  X,
  HelpCircle,
  Pause,
  Play,
  Layers,
  GitBranch,
  Shield,
  Cpu,
} from 'lucide-react';
import { TRACE_TYPES } from '@/lib/constants';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import { THEME } from '@/lib/theme';
import { TraceStep } from '@/lib/types/ui';

interface StepDetailPanelProps {
  selectedStep: TraceStep;
  onClose: () => void;
}

/** Renders detailed information for a selected trace step. */
export default function StepDetailPanel({ selectedStep, onClose }: StepDetailPanelProps) {
  return (
    <div className="absolute top-4 right-4 bottom-4 w-96 bg-[#0a0f1a]/95 border border-cyber-green/30 shadow-[0_0_30px_rgba(0,255,163,0.1)] z-50 rounded-lg flex flex-col animate-in slide-in-from-right-10 duration-300">
      <header className="p-4 border-b border-white/10 flex justify-between items-center bg-black/40 shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={16} className={`text-${THEME.COLORS.PRIMARY}`} />
          <Typography variant="caption" weight="black" className="tracking-[0.2em]">
            Step details
          </Typography>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-white/40 hover:text-white p-2 h-auto"
          icon={<X size={16} />}
        />
      </header>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
        <div className="space-y-1">
          <Typography
            variant="mono"
            weight="bold"
            color="primary"
            className="text-[9px] tracking-tighter"
          >
            Event type
          </Typography>
          <Typography
            variant="caption"
            weight="bold"
            color="white"
            className="bg-white/5 p-2 rounded border border-white/5 capitalize block"
          >
            {selectedStep.type.replace('_', ' ')}
          </Typography>
        </div>

        {selectedStep.type === TRACE_TYPES.LLM_CALL && (
          <div className="space-y-2">
            <div className="text-[10px] text-cyber-blue font-bold tracking-tighter flex items-center gap-1">
              <Code size={12} /> Prompt context
            </div>
            <div className="space-y-2">
              {selectedStep.content.messages.map(
                (msg: { role: string; content: string }, idx: number) => (
                  <div
                    key={idx}
                    className="p-2 bg-white/[0.02] border border-white/5 rounded text-[11px] font-mono"
                  >
                    <div className="text-cyber-blue/60 mb-1 text-[9px] font-bold">[{msg.role}]</div>
                    <div className="text-white/80 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.LLM_RESPONSE && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-cyber-green font-bold tracking-tighter flex items-center gap-1">
                <MessageSquare size={12} /> LLM content
              </div>
              <div className="p-2 bg-white/[0.02] border border-white/5 rounded text-[11px] font-mono text-white/80 whitespace-pre-wrap leading-relaxed">
                {(() => {
                  const content = selectedStep.content.content ?? selectedStep.content.response;
                  if (!content) return 'No text content provided.';
                  try {
                    const parsed = JSON.parse(content);
                    return JSON.stringify(parsed, null, 2);
                  } catch {
                    return content;
                  }
                })()}
              </div>
            </div>
            {selectedStep.content.tool_calls && (
              <div className="space-y-2">
                <div className="text-[10px] text-yellow-500 font-bold tracking-tighter flex items-center gap-1">
                  <Wrench size={12} /> Delegated tools
                </div>
                {selectedStep.content.tool_calls.map(
                  (tc: { function: { name: string; arguments: string } }, idx: number) => (
                    <div
                      key={idx}
                      className="p-2 bg-yellow-500/5 border border-yellow-500/20 rounded text-[10px] font-mono"
                    >
                      <div className="text-yellow-500/80 mb-1 font-bold">{tc.function.name}</div>
                      <div className="text-white/60 truncate">{tc.function.arguments}</div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.TOOL_CALL && (
          <div className="space-y-2">
            <div className="text-[10px] text-yellow-500 font-bold tracking-tighter flex items-center gap-1">
              <Terminal size={12} /> Tool input (JSON)
            </div>
            <div className="p-3 bg-black/60 border border-yellow-500/20 rounded text-[11px] font-mono text-yellow-500/90 whitespace-pre-wrap shadow-inner">
              {JSON.stringify(selectedStep.content.args, null, 2)}
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.TOOL_RESULT && (
          <div className="space-y-2">
            <div className="text-[10px] text-cyber-green font-bold tracking-tighter flex items-center gap-1">
              <CheckCircle size={12} /> Tool output
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
            <div className="text-[10px] text-red-500 font-bold tracking-tighter flex items-center gap-1">
              <ShieldAlert size={12} /> Error details
            </div>
            <div className="p-3 bg-red-500/5 border border-red-500/20 rounded text-[11px] font-mono text-red-400 whitespace-pre-wrap shadow-inner">
              {selectedStep.content.errorMessage}
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.CLARIFICATION_REQUEST && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-purple-400 font-bold tracking-tighter flex items-center gap-1">
                <HelpCircle size={12} /> Clarification Question
              </div>
              <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded text-[11px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed italic">
                &quot;{selectedStep.content.question ?? 'No question provided'}&quot;
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[10px] text-white/60 font-bold">Original Task</div>
              <div className="p-2 bg-white/[0.02] border border-white/10 rounded text-[10px] font-mono text-white/70">
                {selectedStep.content.originalTask ?? 'N/A'}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Requesting Agent</div>
                <div className="text-[10px] text-purple-400 font-mono">
                  {selectedStep.content.agentId ?? 'unknown'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Retry Count</div>
                <div className="text-[10px] text-purple-400 font-mono">
                  {selectedStep.content.retryCount ?? 0}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Depth</div>
                <div className="text-[10px] text-purple-400 font-mono">
                  {selectedStep.content.depth ?? 0}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.AGENT_WAITING && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-yellow-400 font-bold tracking-tighter flex items-center gap-1">
                <Pause size={12} /> Agent Waiting
              </div>
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded text-[11px] font-mono text-white/90 whitespace-pre-wrap">
                {selectedStep.content.reason ?? 'Agent is waiting for external input'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] text-white/40 font-bold">Agent</div>
              <div className="text-[10px] text-yellow-400 font-mono">
                {selectedStep.content.agentId ?? 'unknown'}
              </div>
            </div>
            {selectedStep.content.question && (
              <div className="space-y-2">
                <div className="text-[10px] text-white/60 font-bold">Waiting For</div>
                <div className="p-2 bg-white/[0.02] border border-white/10 rounded text-[10px] font-mono text-white/70 italic">
                  &quot;{selectedStep.content.question}&quot;
                </div>
              </div>
            )}
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.AGENT_RESUMED && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-emerald-400 font-bold tracking-tighter flex items-center gap-1">
                <Play size={12} /> Agent Resumed
              </div>
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded text-[11px] font-mono text-white/90 whitespace-pre-wrap">
                {selectedStep.content.reason ?? 'Agent resumed execution'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] text-white/40 font-bold">Agent</div>
              <div className="text-[10px] text-emerald-400 font-mono">
                {selectedStep.content.agentId ?? 'unknown'}
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.PARALLEL_DISPATCH && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-violet-400 font-bold tracking-tighter flex items-center gap-1">
                <Layers size={12} /> Parallel Dispatch
              </div>
              <div className="p-3 bg-violet-500/5 border border-violet-500/20 rounded text-[11px] font-mono text-white/90">
                Dispatching {selectedStep.content.taskCount} tasks in parallel
              </div>
            </div>
            {selectedStep.content.tasks && (
              <div className="space-y-2">
                <div className="text-[10px] text-white/60 font-bold">Tasks</div>
                <div className="space-y-1">
                  {selectedStep.content.tasks.map(
                    (t: { taskId: string; agentId: string; task: string }, idx: number) => (
                      <div
                        key={idx}
                        className="p-2 bg-white/[0.02] border border-white/10 rounded text-[10px] font-mono"
                      >
                        <div className="text-violet-400 font-bold">{t.agentId}</div>
                        <div className="text-white/60 truncate">{t.task}</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Aggregation</div>
                <div className="text-[10px] text-violet-400 font-mono">
                  {selectedStep.content.aggregationType ?? 'summary'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Timeout</div>
                <div className="text-[10px] text-violet-400 font-mono">
                  {selectedStep.content.barrierTimeoutMs
                    ? `${Math.round(selectedStep.content.barrierTimeoutMs / 1000)}s`
                    : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.PARALLEL_BARRIER && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-violet-400 font-bold tracking-tighter flex items-center gap-1">
                <Layers size={12} /> Parallel Barrier
              </div>
              <div className="p-3 bg-violet-500/5 border border-violet-500/20 rounded text-[11px] font-mono text-white/90">
                Waiting for {selectedStep.content.taskCount} sub-agents to complete
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Status</div>
                <div className="text-[10px] text-violet-400 font-mono">
                  {selectedStep.content.status}
                </div>
              </div>
              {selectedStep.content.targetTime && (
                <div className="space-y-1">
                  <div className="text-[9px] text-white/40 font-bold">Target Time</div>
                  <div className="text-[10px] text-violet-400 font-mono">
                    {selectedStep.content.targetTime}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.COUNCIL_REVIEW && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-red-400 font-bold tracking-tighter flex items-center gap-1">
                <Shield size={12} /> Council Review
              </div>
              <div className="p-3 bg-red-500/5 border border-red-500/20 rounded text-[11px] font-mono text-white/90">
                {selectedStep.content.reviewType}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] text-white/40 font-bold">Status</div>
              <div className="text-[10px] text-red-400 font-mono">
                {selectedStep.content.status}
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.CONTINUATION && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-teal-400 font-bold tracking-tighter flex items-center gap-1">
                <GitBranch size={12} /> Continuation
              </div>
              <div className="p-3 bg-teal-500/5 border border-teal-500/20 rounded text-[11px] font-mono text-white/90">
                {selectedStep.content.direction === 'to_initiator'
                  ? 'Result routed back to initiator'
                  : 'Agent resuming with new context'}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Initiator</div>
                <div className="text-[10px] text-teal-400 font-mono">
                  {selectedStep.content.initiatorId ?? 'N/A'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Requesting Agent</div>
                <div className="text-[10px] text-teal-400 font-mono">
                  {selectedStep.content.requestingAgent ?? 'N/A'}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.CIRCUIT_BREAKER && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-orange-400 font-bold tracking-tighter flex items-center gap-1">
                <Cpu size={12} /> Circuit Breaker State Change
              </div>
              <div className="p-3 bg-orange-500/5 border border-orange-500/20 rounded text-[11px] font-mono text-white/90">
                State transitioned from{' '}
                <span className="text-orange-400 font-bold">
                  {selectedStep.content.previousState}
                </span>{' '}
                to{' '}
                <span className="text-orange-400 font-bold">{selectedStep.content.newState}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[10px] text-white/60 font-bold">Reason</div>
              <div className="p-2 bg-white/[0.02] border border-white/10 rounded text-[10px] font-mono text-white/70">
                {selectedStep.content.reason ?? 'N/A'}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Failure Type</div>
                <div className="text-[10px] text-orange-400 font-mono">
                  {selectedStep.content.failureType ?? 'N/A'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Failure Count</div>
                <div className="text-[10px] text-orange-400 font-mono">
                  {selectedStep.content.failureCount ?? 0}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.CANCELLATION && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-rose-400 font-bold tracking-tighter flex items-center gap-1">
                <ShieldAlert size={12} /> Task Cancellation
              </div>
              <div className="p-3 bg-rose-500/5 border border-rose-500/20 rounded text-[11px] font-mono text-white/90">
                Task terminated
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Task ID</div>
                <div className="text-[10px] text-rose-400 font-mono">
                  {selectedStep.content.taskId ? selectedStep.content.taskId.slice(0, 8) : 'N/A'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Initiator</div>
                <div className="text-[10px] text-rose-400 font-mono">
                  {selectedStep.content.initiatorId ?? 'N/A'}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[10px] text-white/60 font-bold">Reason</div>
              <div className="p-2 bg-white/[0.02] border border-white/10 rounded text-[10px] font-mono text-white/70">
                {selectedStep.content.reason ?? 'No reason provided'}
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.MEMORY_OPERATION && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-cyan-400 font-bold tracking-tighter flex items-center gap-1">
                <Brain size={12} /> Memory Operation
              </div>
              <div className="p-3 bg-cyan-500/5 border border-cyan-500/20 rounded text-[11px] font-mono text-white/90">
                {selectedStep.content.operation}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Key</div>
                <div className="text-[10px] text-cyan-400 font-mono">
                  {selectedStep.content.key ?? 'N/A'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[9px] text-white/40 font-bold">Scope</div>
                <div className="text-[10px] text-cyan-400 font-mono">
                  {selectedStep.content.scope ?? 'N/A'}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === TRACE_TYPES.REFLECT && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-indigo-400 font-bold tracking-tighter flex items-center gap-1">
                <Brain size={12} /> Agent Reflection
              </div>
              <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded text-[11px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed">
                {selectedStep.content.reflection}
              </div>
            </div>
          </div>
        )}

        {selectedStep.type === 'trigger' && (
          <div className="space-y-2">
            <div className="text-[10px] text-white/60 font-bold">Initial context</div>
            <div className="p-3 bg-white/[0.02] border border-white/10 rounded text-xs text-white/80">
              {JSON.stringify(selectedStep.content, null, 2)}
            </div>
          </div>
        )}

        {selectedStep.type === 'result' && (
          <div className="space-y-2">
            <div className="text-[10px] text-cyber-green font-bold">Transmission complete</div>
            <div className="p-3 bg-cyber-green/5 border border-cyber-green/20 rounded text-xs text-white/90 whitespace-pre-wrap">
              {selectedStep.content.response}
            </div>
          </div>
        )}
      </div>

      <footer className="p-3 border-t border-white/10 bg-black/20 shrink-0 flex justify-between">
        <Typography
          variant="mono"
          color="muted"
          className="text-[7px] tracking-widest italic opacity-40"
        >
          ID: {selectedStep.stepId?.substring(0, 8) || 'N/A'}
        </Typography>
        <Typography
          variant="mono"
          color="muted"
          className="text-[7px] tracking-widest italic opacity-40"
        >
          {selectedStep.timestamp ? new Date(selectedStep.timestamp).toLocaleTimeString() : ''}
        </Typography>
      </footer>
    </div>
  );
}
