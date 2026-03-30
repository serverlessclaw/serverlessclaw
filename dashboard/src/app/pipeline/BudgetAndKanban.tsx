'use client';

import React, { useEffect, useState } from 'react';
import Typography from '@/components/ui/Typography';
import EvolutionBudgetView from '@/components/EvolutionBudgetView';
import EvolutionKanban from '@/components/EvolutionKanban';
import { EvolutionTrack, GapStatus } from '@claw/core/lib/types/agent';

interface TrackBudget {
  track: string;
  allocated: number;
  spent: number;
}

interface KanbanGap {
  id: string;
  title: string;
  status: GapStatus;
  track: EvolutionTrack;
  priority: number;
}

interface BudgetAndKanbanProps {
  gaps: KanbanGap[];
}

export default function BudgetAndKanban({ gaps }: BudgetAndKanbanProps) {
  const [budgets, setBudgets] = useState<TrackBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchBudget() {
      try {
        const res = await fetch('/api/budget');
        const data = await res.json();
        setBudgets(data.budgets || []);
      } catch (e) {
        console.error('Failed to fetch budget:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBudget();
  }, []);

  return (
    <div className="space-y-10">
      <section>
        <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2 mb-6">
          Evolution Budget
        </Typography>
        {isLoading ? (
          <div className="py-10 text-center">
            <Typography variant="body" color="muted">Loading budget data...</Typography>
          </div>
        ) : (
          <EvolutionBudgetView budgets={budgets} />
        )}
      </section>

      <section>
        <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2 mb-6">
          Multi-Track Kanban
        </Typography>
        <EvolutionKanban gaps={gaps} />
      </section>
    </div>
  );
}
