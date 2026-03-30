'use client';

import React, { useState } from 'react';
import Typography from '@/components/ui/Typography';
import { ChevronDown, ChevronUp, GitCommit } from 'lucide-react';
import PlanDecompositionTree from '@/components/PlanDecompositionTree';

const SAMPLE_PLAN = {
  planId: 'PLAN#001',
  title: 'Evolution Plan: Capability Upgrade',
  subTasks: [
    { subTaskId: 'SUB#001', task: 'Analyze current capability gaps and prioritize by impact score', status: 'DONE' as const, order: 0 },
    { subTaskId: 'SUB#002', task: 'Generate code modifications addressing identified gaps', status: 'PROGRESS' as const, order: 1 },
    { subTaskId: 'SUB#003', task: 'Run pre-flight validation and safety checks', status: 'PENDING' as const, order: 2 },
    { subTaskId: 'SUB#004', task: 'Deploy to staging and run integration tests', status: 'PENDING' as const, order: 3 },
    { subTaskId: 'SUB#005', task: 'QA audit and trace verification', status: 'PENDING' as const, order: 4 },
  ],
};

export default function PlanView() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-4 px-2 hover:bg-white/[0.02] rounded-lg transition-colors"
      >
        <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2">
          <GitCommit size={14} className="text-cyber-blue" /> Plan Decomposition
        </Typography>
        {expanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </button>

      {expanded && (
        <PlanDecompositionTree
          planId={SAMPLE_PLAN.planId}
          title={SAMPLE_PLAN.title}
          subTasks={SAMPLE_PLAN.subTasks}
        />
      )}
    </section>
  );
}
