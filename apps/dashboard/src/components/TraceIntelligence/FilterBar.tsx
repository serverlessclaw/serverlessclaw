'use client';

import React from 'react';
import { Activity, Clock, LayoutGrid, Cpu, Bot, Wrench, Search } from 'lucide-react';
import { TabType, TranslationFn } from './types';

interface FilterBarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: 'all' | 'completed' | 'started' | 'error';
  setStatusFilter: (status: 'all' | 'completed' | 'started' | 'error') => void;
  sourceFilter: string;
  setSourceFilter: (source: string) => void;
  dateFilter: string;
  setDateFilter: (date: 'all' | '24h' | '7d') => void;
  t: TranslationFn;
}

export default function FilterBar({
  activeTab,
  setActiveTab,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  sourceFilter,
  setSourceFilter,
  dateFilter,
  setDateFilter,
  t,
}: FilterBarProps) {
  const tabs = [
    { id: 'live', label: t('LIVE'), icon: Activity },
    { id: 'timeline', label: t('TIMELINE'), icon: Clock },
    { id: 'sessions', label: t('SESSIONS'), icon: LayoutGrid },
    { id: 'agents', label: t('AGENTS'), icon: Cpu },
    { id: 'models', label: t('MODELS'), icon: Bot },
    { id: 'tools', label: t('TOOLS'), icon: Wrench },
  ];

  return (
    <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-6 border-b border-border pb-6 max-w-full overflow-hidden">
      <div className="flex p-1 bg-foreground/5 rounded-xl border border-border w-full 2xl:w-auto overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`flex-1 2xl:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[10px] md:text-[11px] font-bold uppercase tracking-wider transition-all duration-300 ${
              activeTab === tab.id
                ? tab.id === 'live'
                  ? 'bg-cyber-green/10 text-cyber-green border border-cyber-green/20 shadow-[0_0_15px_color-mix(in_srgb,var(--cyber-green)_10%,transparent)]'
                  : 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/20 shadow-[0_0_15px_color-mix(in_srgb,var(--cyber-blue)_10%,transparent)]'
                : 'text-muted-foreground hover:text-foreground/60 hover:bg-foreground/5'
            }`}
          >
            <tab.icon
              size={tab.id === 'live' ? 12 : 14}
              className={activeTab === tab.id && tab.id === 'live' ? 'animate-pulse' : ''}
            />
            <span className="hidden md:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        className={`flex flex-wrap items-center gap-3 w-full 2xl:w-auto 2xl:justify-end overflow-hidden transition-all duration-300 min-h-[40px] ${
          activeTab === 'live' ? 'opacity-0 pointer-events-none invisible' : 'opacity-100 visible'
        }`}
      >
        <div className="relative group flex-1 md:flex-none">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 group-focus-within:text-cyber-blue transition-colors"
          />
          <input
            type="text"
            placeholder={t('FILTER_NEURAL_PATHS')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-foreground/5 border border-border rounded-lg pl-10 pr-4 py-2 text-xs text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-cyber-blue/50 w-full md:w-48 lg:w-64 transition-all"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'completed' | 'started' | 'error')}
          className="bg-foreground/5 border border-border rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground focus:outline-none focus:border-cyber-blue/50 flex-1 md:flex-none min-w-[100px]"
        >
          <option value="all">{t('STATUS_ALL')}</option>
          <option value="completed">{t('STATUS_COMPLETED')}</option>
          <option value="started">{t('STATUS_RUNNING')}</option>
          <option value="error">{t('STATUS_ERROR')}</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-foreground/5 border border-border rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground focus:outline-none focus:border-cyber-blue/50 flex-1 md:flex-none min-w-[100px]"
        >
          <option value="all">All Sources</option>
          <option value="telegram">Telegram</option>
          <option value="dashboard">Dashboard</option>
          <option value="system">System</option>
        </select>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as 'all' | '24h' | '7d')}
          className="bg-foreground/5 border border-border rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground focus:outline-none focus:border-cyber-blue/50 flex-1 md:flex-none min-w-[100px]"
        >
          <option value="all">All Time (30 Days)</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 Days</option>
          {dateFilter === 'custom' && <option value="custom">Custom Range</option>}
        </select>
      </div>
    </div>
  );
}
