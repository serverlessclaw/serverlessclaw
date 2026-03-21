'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';

interface Tab {
  id: string;
  label: string;
  count: number;
  icon: React.ReactNode;
}

interface MemoryTabsProps {
  tabs: Tab[];
}

export default function MemoryTabs({ tabs }: MemoryTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || tabs[0].id;

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.push(`/memory?${params.toString()}`);
  };

  return (
    <div className="flex border-b border-white/5 mb-8 overflow-x-auto scrollbar-hide">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => handleTabChange(tab.id)}
          className={`flex items-center gap-2 px-6 py-4 border-b-2 transition-all whitespace-nowrap ${
            activeTab === tab.id
              ? 'border-cyber-blue text-white bg-cyber-blue/5'
              : 'border-transparent text-muted hover:text-white hover:bg-white/5'
          }`}
        >
          <span className={`${activeTab === tab.id ? 'text-cyber-blue' : 'text-muted'}`}>
            {tab.icon}
          </span>
          <Typography 
            variant="mono" 
            weight={activeTab === tab.id ? "bold" : "medium"} 
            uppercase 
            className="text-[11px] tracking-widest"
          >
            {tab.label}
          </Typography>
          <Badge 
            variant={activeTab === tab.id ? "intel" : "outline"} 
            className="ml-1 px-2 py-0.5 text-[10px] font-black"
          >
            {tab.count}
          </Badge>
        </button>
      ))}
    </div>
  );
}
