'use client';

import React, { useState } from 'react';
import Typography from '@/components/ui/Typography';
import { ChevronDown, ChevronUp, GitCommit } from 'lucide-react';
import PlanDecompositionTree, { SubTask } from '@/components/PlanDecompositionTree';

interface PlanData {
  planId: string;
  title: string;
  subTasks: SubTask[];
}

export default function PlanView() {
  const [expanded, setExpanded] = useState(false);
  const [plan] = useState<PlanData | null>(null);

  if (!plan) {
    return (
      <section className="bg-card/80 backdrop-blur-xl border border-border rounded-xl overflow-hidden glass-card opacity-50 transition-opacity hover:opacity-100">
        <div className="py-3 px-6 flex items-center justify-between text-[10px] text-muted-more uppercase font-bold tracking-widest">
          <div className="flex items-center gap-3">
            <GitCommit size={14} className="text-muted-more/40" />
            <span>Authorize a plan to see decomposition</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card/90 backdrop-blur-xl border border-border rounded-xl overflow-hidden shadow-premium">
      {expanded && (
        <div className="max-h-[65vh] overflow-y-auto border-b border-border custom-scrollbar">
          <PlanDecompositionTree planId={plan.planId} title={plan.title} subTasks={plan.subTasks} />
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-6 hover:bg-foreground/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <GitCommit size={14} className="text-cyber-blue" />
          <Typography
            variant="mono"
            className="text-[11px] font-black tracking-[0.2em] uppercase text-foreground/80"
          >
            Plan Decomposition <span className="text-muted-more ml-2">ID: {plan.planId}</span>
          </Typography>
        </div>
        {expanded ? (
          <ChevronDown size={16} className="text-cyber-blue" />
        ) : (
          <ChevronUp size={16} className="text-muted-more" />
        )}
      </button>
    </section>
  );
}
