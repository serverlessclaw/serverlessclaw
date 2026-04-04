'use client';

import React, { useState } from 'react';
import Typography from '@/components/ui/Typography';
import { ChevronDown, ChevronUp, GitCommit } from 'lucide-react';
import PlanDecompositionTree from '@/components/PlanDecompositionTree';

const SAMPLE_PLAN = {
  planId: 'PLAN#001',
  title: 'Evolution Plan: Capability Upgrade',
  subTasks: [
    {
      subTaskId: 'SUB#001',
      task: 'Analyze current capability gaps and prioritize by impact score',
      status: 'DONE' as const,
      order: 0,
    },
    {
      subTaskId: 'SUB#002',
      task: 'Generate code modifications addressing identified gaps',
      status: 'PROGRESS' as const,
      order: 1,
    },
    {
      subTaskId: 'SUB#003',
      task: 'Run pre-flight validation and safety checks',
      status: 'PENDING' as const,
      order: 2,
    },
    {
      subTaskId: 'SUB#004',
      task: 'Deploy to staging and run integration tests',
      status: 'PENDING' as const,
      order: 3,
    },
    {
      subTaskId: 'SUB#005',
      task: 'QA audit and trace verification',
      status: 'PENDING' as const,
      order: 4,
    },
  ],
};

export default function PlanView() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl">
      {expanded && (
        <div className="max-h-[65vh] overflow-y-auto border-b border-white/10 custom-scrollbar">
          <PlanDecompositionTree
            planId={SAMPLE_PLAN.planId}
            title={SAMPLE_PLAN.title}
            subTasks={SAMPLE_PLAN.subTasks}
          />
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-6 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <GitCommit size={14} className="text-cyber-blue" />
          <Typography
            variant="mono"
            className="text-[11px] font-black tracking-[0.2em] uppercase text-white/80"
          >
            Plan Decomposition <span className="text-white/20 ml-2">ID: {SAMPLE_PLAN.planId}</span>
          </Typography>
        </div>
        {expanded ? (
          <ChevronDown size={16} className="text-cyber-blue" />
        ) : (
          <ChevronUp size={16} className="text-white/40" />
        )}
      </button>
    </section>
  );
}
