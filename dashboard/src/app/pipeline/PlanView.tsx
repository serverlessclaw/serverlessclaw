'use client';

import React, { useState, useEffect } from 'react';
import Typography from '@/components/ui/Typography';
import { ChevronDown, ChevronUp, GitCommit } from 'lucide-react';
import PlanDecompositionTree from '@/components/PlanDecompositionTree';

interface SubTask {
  subTaskId: string;
  task: string;
  status: 'PENDING' | 'PROGRESS' | 'DONE' | 'FAILED';
  order: number;
}

interface PlanData {
  planId: string;
  title: string;
  subTasks: SubTask[];
}

export default function PlanView() {
  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch the most recent authorized plan for summary
  useEffect(() => {
    const fetchLatestPlan = async () => {
      setLoading(true);
      try {
        // In a real scenario, we might fetch the specific plan for an active gap.
        // For the summary view, we fetch the most recent one.
        const res = await fetch('/api/memory/gap/metrics'); // Hypothetical or reuse existing
        // For now, we'll keep it simple: if no plan is explicitly passed, 
        // this view remains a placeholder or shows "Select a gap to view plan"
      } catch (err) {
        console.error('Failed to load summary plan:', err);
      } finally {
        setLoading(false);
      }
    };
    // fetchLatestPlan(); // Disable for now to avoid noise, wait for user selection
  }, []);

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
          <PlanDecompositionTree
            planId={plan.planId}
            title={plan.title}
            subTasks={plan.subTasks}
          />
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
