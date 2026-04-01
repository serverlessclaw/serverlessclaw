'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import { DollarSign, TrendingUp, AlertTriangle, PieChart } from 'lucide-react';
import { TrackBudget } from '@/lib/types/dashboard';

export default function EvolutionBudgetView({ budgets }: { budgets: TrackBudget[] }) {
  const totalAllocated = budgets.reduce((acc, b) => acc + b.allocated, 0);
  const totalSpent = budgets.reduce((acc, b) => acc + b.spent, 0);
  const totalPercent = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white/5 border border-white/10 p-6 rounded-2xl relative overflow-hidden group">
        <div className="absolute -right-4 -top-4 w-20 h-20 bg-cyber-blue/10 rounded-full blur-2xl group-hover:bg-cyber-blue/20 transition-all" />
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-cyber-blue/10 rounded-xl text-cyber-blue">
            <DollarSign size={20} />
          </div>
          <Typography variant="mono" className="text-xs uppercase tracking-widest text-white/40 font-bold">TOTAL_ALLOCATED</Typography>
        </div>
        <Typography variant="h2" glow>${totalAllocated.toFixed(2)}</Typography>
      </div>

      <div className="bg-white/5 border border-white/10 p-6 rounded-2xl relative overflow-hidden group">
        <div className="absolute -right-4 -top-4 w-20 h-20 bg-cyber-green/10 rounded-full blur-2xl group-hover:bg-cyber-green/20 transition-all" />
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-cyber-green/10 rounded-xl text-cyber-green">
            <TrendingUp size={20} />
          </div>
          <Typography variant="mono" className="text-xs uppercase tracking-widest text-white/40 font-bold">TOTAL_SPENT</Typography>
        </div>
        <Typography variant="h2" className="text-cyber-green" glow>${totalSpent.toFixed(2)}</Typography>
      </div>

      <div className="bg-white/5 border border-white/10 p-6 rounded-2xl relative overflow-hidden group">
        <div className="absolute -right-4 -top-4 w-20 h-20 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all" />
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-500">
            <PieChart size={20} />
          </div>
          <Typography variant="mono" className="text-xs uppercase tracking-widest text-white/40 font-bold">BUDGET_UTILIZATION</Typography>
        </div>
        <Typography variant="h2" className="text-amber-500" glow>{totalPercent.toFixed(1)}%</Typography>
      </div>
    </div>
  );
}
