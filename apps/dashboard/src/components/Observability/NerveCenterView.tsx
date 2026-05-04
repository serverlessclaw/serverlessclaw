'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Activity, ShieldAlert, Brain, Lock, Loader2, Zap } from 'lucide-react';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

// Dynamic imports for the heavy sub-views
const PulseFlow = dynamic(() => import('../../app/system-pulse/Flow'), {
  ssr: false,
  loading: () => <LoadingPlaceholder label="Establishing Neural Uplink..." />,
});

const ResilienceSection = dynamic(() => import('./ResilienceView'), {
  loading: () => <LoadingPlaceholder label="Quantizing Stability Gauges..." />,
});

const CognitiveSection = dynamic(() => import('./CognitiveView'), {
  loading: () => <LoadingPlaceholder label="Calibrating Reasoning Coherence..." />,
});

const LocksSection = dynamic(() => import('./LocksView'), {
  loading: () => <LoadingPlaceholder label="Querying Concurrency State..." />,
});

function LoadingPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
      <Loader2 size={32} className="animate-spin text-cyber-blue mb-4" />
      <div className="text-muted-foreground animate-pulse font-mono uppercase text-xs tracking-widest">
        {label}
      </div>
    </div>
  );
}

type TabId = 'pulse' | 'resilience' | 'cognitive' | 'locks';

export default function NerveCenterView() {
  const { t } = useTranslations();
  const [activeTab, setActiveTab] = useState<TabId>('pulse');

  const tabs = [
    { id: 'pulse' as TabId, label: t('TAB_PULSE'), icon: Activity, color: 'text-cyber-blue' },
    {
      id: 'resilience' as TabId,
      label: t('TAB_RESILIENCE'),
      icon: ShieldAlert,
      color: 'text-yellow-500',
    },
    { id: 'cognitive' as TabId, label: t('TAB_COGNITIVE'), icon: Brain, color: 'text-cyan-400' },
    { id: 'locks' as TabId, label: t('TAB_TRAFFIC'), icon: Lock, color: 'text-orange-500' },
  ];

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Tab Switcher */}
      <div
        className="flex items-center gap-2 p-1 bg-card/40 border border-border rounded-lg w-fit"
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${tab.id}-panel`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all font-mono text-[10px] uppercase tracking-widest ${
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
            }`}
          >
            <tab.icon size={14} className={activeTab === tab.id ? tab.color : ''} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* View Container */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'pulse' && (
          <div className="flex-1 min-h-[600px] glass-card border-border overflow-hidden flex flex-col bg-card/20">
            <div className="px-6 py-3 border-b border-border bg-card/40 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground">
                <Zap size={14} className="text-cyber-blue" /> Infrastructure Map
              </div>
            </div>
            <div className="flex-1 relative">
              <PulseFlow />
            </div>
          </div>
        )}

        {activeTab === 'resilience' && <ResilienceSection />}
        {activeTab === 'cognitive' && <CognitiveSection />}
        {activeTab === 'locks' && <LocksSection />}
      </div>
    </div>
  );
}
