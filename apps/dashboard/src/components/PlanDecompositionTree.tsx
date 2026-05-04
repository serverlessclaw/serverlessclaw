'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import { GitCommit, ArrowDown, CheckCircle2, Circle, Clock } from 'lucide-react';

export interface SubTask {
  subTaskId: string;
  task: string;
  status: 'PENDING' | 'PROGRESS' | 'DONE' | 'FAILED';
  order: number;
}

interface PlanTreeProps {
  planId: string;
  title: string;
  subTasks: SubTask[];
}

export default function PlanDecompositionTree({ planId, title, subTasks }: PlanTreeProps) {
  const sortedTasks = [...subTasks].sort((a, b) => a.order - b.order);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 lg:p-8 space-y-8 relative overflow-hidden">
      {/* Connector Line */}
      <div className="absolute left-12 top-24 bottom-12 w-px bg-gradient-to-b from-cyber-blue/40 via-white/5 to-transparent z-0" />

      <div className="relative z-10 flex items-start gap-6">
        <div className="p-3 bg-cyber-blue/20 rounded-xl text-cyber-blue shadow-[0_0_20px_rgba(0,243,255,0.2)]">
          <GitCommit size={24} />
        </div>
        <div>
          <Typography variant="h3" glow uppercase>
            {title}
          </Typography>
          <Typography
            variant="mono"
            color="muted"
            className="text-xs mt-1 uppercase tracking-widest opacity-40"
          >
            ROOT_PLAN: {planId}
          </Typography>
        </div>
      </div>

      <div className="space-y-6 relative z-10">
        {sortedTasks.map((task, index) => (
          <div key={task.subTaskId} className="flex gap-6 items-start group">
            <div className="flex flex-col items-center pt-1">
              <div
                className={`
                w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-500
                ${
                  task.status === 'DONE'
                    ? 'bg-cyber-green/20 border-cyber-green text-cyber-green'
                    : task.status === 'PROGRESS'
                      ? 'bg-cyber-blue/20 border-cyber-blue text-cyber-blue animate-pulse'
                      : 'bg-white/5 border-white/10 text-white/40 group-hover:border-white/20'
                }
              `}
              >
                {task.status === 'DONE' ? (
                  <CheckCircle2 size={16} />
                ) : task.status === 'PROGRESS' ? (
                  <Clock size={16} />
                ) : (
                  <Circle size={12} />
                )}
              </div>
              {index < sortedTasks.length - 1 && (
                <div className="py-2">
                  <ArrowDown size={14} className="text-white/10" />
                </div>
              )}
            </div>

            <div className="flex-1 bg-white/[0.02] border border-white/5 p-4 rounded-xl hover:bg-white/[0.05] transition-all">
              <div className="flex justify-between items-start mb-2">
                <Typography
                  variant="mono"
                  className="text-[10px] uppercase tracking-tighter opacity-40 font-bold"
                >
                  SUB_TASK_{task.order + 1}
                </Typography>
                <div
                  className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                    task.status === 'DONE'
                      ? 'bg-cyber-green/20 text-cyber-green'
                      : task.status === 'PROGRESS'
                        ? 'bg-cyber-blue/20 text-cyber-blue'
                        : 'bg-white/10 text-white/40'
                  }`}
                >
                  {task.status}
                </div>
              </div>
              <Typography variant="body" className="text-sm leading-relaxed text-white/80">
                {task.task}
              </Typography>
              <Typography variant="mono" className="text-[9px] mt-2 block opacity-20 truncate">
                ID: {task.subTaskId}
              </Typography>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
