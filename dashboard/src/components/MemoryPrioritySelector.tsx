'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';

interface MemoryPrioritySelectorProps {
  userId: string;
  timestamp: number;
  currentPriority: number;
}

/**
 * Client component to handle interactive priority selection in the neural reserve.
 * Prevents "Event handlers cannot be passed to Client Component props" errors
 * by encapsulating interactivity.
 */
export default function MemoryPrioritySelector({
  userId,
  timestamp,
  currentPriority,
}: MemoryPrioritySelectorProps) {
  return (
    <form className="flex items-center gap-2 bg-background/40 px-2 py-1 rounded border border-border">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="timestamp" value={timestamp} />
      <Typography
        variant="caption"
        weight="bold"
        color="white"
        uppercase
        className="text-[9px] tracking-tighter"
      >
        Prio:
      </Typography>
      <select
        name="priority"
        defaultValue={currentPriority}
        onChange={(e) => {
          // In a real app we might use useFormStatus or a Server Action directly
          // For now, we mimic the previous behavior by submitting the closest form
          e.target.form?.requestSubmit();
        }}
        className="bg-transparent text-amber-400 text-[10px] font-bold outline-none cursor-pointer"
      >
        {[1, 3, 5, 7, 8, 10].map((p) => (
          <option key={p} value={p} className="bg-card">
            {p}
          </option>
        ))}
      </select>
    </form>
  );
}
