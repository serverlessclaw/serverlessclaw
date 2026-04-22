import React from 'react';
import NerveCenterView from '@/components/Observability/NerveCenterView';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

/**
 * Unified Observability Hub (Nerve Center)
 * Consolidates technical system states into a single tabbed dashboard.
 */
export default function ObservabilityHubPage() {
  return (
    <div className="flex-1 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <PageHeader titleKey="OBSERVABILITY" subtitleKey="SYSPULSE_SUBTITLE" />

      <div className="flex-1 min-h-[600px]">
        <NerveCenterView />
      </div>
    </div>
  );
}
