import React from 'react';
import ScheduleList from './ScheduleList';

export const dynamic = 'force-dynamic';

export default function SchedulingPage() {
  return (
    <main className="flex-1 overflow-y-auto p-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-500/5 via-transparent to-transparent">
      <ScheduleList />
    </main>
  );
}
