'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';

interface Tab {
  id: string;
  label: string;
  count: number | string;
  icon: React.ReactNode;
}

interface MemoryTabsProps {
  tabs: Tab[];
}

export default function MemoryTabs({ tabs }: MemoryTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslations();

  if (!tabs || tabs.length === 0) return null;

  const activeTab = searchParams.get('tab') || tabs[0]?.id || '';

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.push(`/memory?${params.toString()}`);
  };

  return (
    <div className="flex gap-1 bg-input/50 p-1 rounded-sm border border-border overflow-x-auto scrollbar-hide w-fit">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`
              flex items-center gap-3 px-6 py-2.5 rounded-sm transition-all whitespace-nowrap
              ${
                isActive
                  ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/30 shadow-[0_0_15px_rgba(0,243,255,0.1)]'
                  : 'text-muted-more hover:text-foreground hover:bg-foreground/5 border border-transparent'
              }
            `}
          >
            <span className={`${isActive ? 'text-cyber-blue' : 'text-muted-more opacity-50'}`}>
              {tab.icon}
            </span>
            <Typography
              variant="mono"
              weight={isActive ? 'black' : 'bold'}
              uppercase
              className="text-[10px] tracking-[0.2em]"
            >
              {t(tab.label as Parameters<typeof t>[0])}
            </Typography>
            <Badge
              variant={isActive ? 'primary' : 'outline'}
              className={`
                ml-1 px-2 py-0 text-[9px] font-black border-none
                ${isActive ? 'bg-cyber-blue text-black' : 'bg-foreground/10 text-muted-more'}
              `}
            >
              {tab.count}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
