'use client';

import React, { useEffect, useState } from 'react';
import EvolutionBudgetView from '@/components/EvolutionBudgetView';
import { TrackBudget } from '@/lib/types/dashboard';

export default function EvolutionBudgetSection() {
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
    <section>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white/5 border border-white/10 p-6 rounded-2xl animate-pulse"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-11 h-11 bg-white/10 rounded-xl" />
                <div className="h-3 w-24 bg-white/10 rounded" />
              </div>
              <div className="h-8 w-32 bg-white/10 rounded mt-2" />
            </div>
          ))}
        </div>
      ) : (
        <EvolutionBudgetView budgets={budgets} />
      )}
    </section>
  );
}
