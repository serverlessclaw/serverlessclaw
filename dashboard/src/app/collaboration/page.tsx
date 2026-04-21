'use client';

import React, { useState, useEffect } from 'react';

import { Vote, Activity, ShieldAlert, Cpu } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import SwarmConsensusView from '@/components/SwarmConsensusView';
import CollaborationCanvas from '@/components/CollaborationCanvas';
import CognitiveHealthCard from '@/components/CognitiveHealthCard';
import TrustGauge from '@/components/TrustGauge';
import PageHeader from '@/components/PageHeader';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

import { ReactFlowProvider } from '@xyflow/react';
import { logger } from '@claw/core/lib/logger';

interface ConsensusRequest {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mode: 'MAJORITY' | 'UNANIMOUS' | 'WEIGHTED';
  votes: { agentId: string; vote: 'YES' | 'NO'; reason?: string; reputation: number }[];
  timestamp: number;
}

type Tab = 'consensus' | 'live';

export default function CollaborationPage() {
  const { t } = useTranslations();
  const [requests, setRequests] = useState<ConsensusRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('live'); // Default to live canvas

  useEffect(() => {
    async function fetchConsensus() {
      try {
        const res = await fetch('/api/consensus');
        const data = await res.json();
        setRequests(data.requests || []);
      } catch (e) {
        logger.error('Failed to fetch consensus requests:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConsensus();
  }, []);

  const tabs = [
    {
      id: 'consensus' as Tab,
      label: t('SWARM_CONSENSUS'),
      icon: Vote,
      count: requests.filter((r) => r.status === 'PENDING').length,
    },
    { id: 'live' as Tab, label: t('LIVE_TASKS'), icon: Activity },
  ];

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <PageHeader
        titleKey="COLLABORATION_TITLE"
        subtitleKey="COLLABORATION_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <div className="glass-card px-4 py-2 border-border flex items-center gap-3">
              <TrustGauge score={94} label="SWARM" size={40} />
              <div>
                <Typography variant="mono" color="muted-more" className="text-[10px] uppercase">
                  {t('SWARM_TRUST')}
                </Typography>
                <Typography variant="mono" weight="black" className="text-xs text-cyber-blue">
                  94.2%
                </Typography>
              </div>
            </div>
            <div className="glass-card px-4 py-2 border-border flex items-center gap-3">
              <div className="p-2 bg-cyber-green/10 rounded-full">
                <ShieldAlert size={16} className="text-cyber-green" />
              </div>
              <div>
                <Typography variant="mono" color="muted-more" className="text-[10px] uppercase">
                  {t('AUTONOMY')}
                </Typography>
                <Typography variant="mono" weight="black" className="text-xs text-cyber-green">
                  LEVEL_3 (AUTO)
                </Typography>
              </div>
            </div>
          </div>
        }
      />

      {/* Trust & Health Overview */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <Typography variant="mono" className="text-[10px] uppercase tracking-[0.3em] font-black mb-4 flex items-center gap-2 opacity-50">
            <Cpu size={12} /> Core_Pulse
          </Typography>
          <CognitiveHealthCard 
            agentId="SuperClaw" 
            score={98} 
            taskCompletionRate={0.99} 
            reasoningCoherence={9.8} 
            errorRate={0.01} 
            memoryFragmentation={0.05} 
            anomalies={[]} 
          />
        </div>
        <div className="lg:col-span-1">
          <Typography variant="mono" className="text-[10px] uppercase tracking-[0.3em] font-black mb-4 flex items-center gap-2 opacity-50 invisible">
            _
          </Typography>
          <CognitiveHealthCard 
            agentId="Planner" 
            score={82} 
            taskCompletionRate={0.88} 
            reasoningCoherence={8.2} 
            errorRate={0.04} 
            memoryFragmentation={0.12} 
            anomalies={[{ type: 'BEHAVIORAL', severity: 'MEDIUM', message: 'Logic depth bottleneck detected' }]} 
          />
        </div>
        <div className="lg:col-span-2 space-y-4">
           {/* Summary Text / Global Feed */}
           <div className="glass-card p-6 border-border h-full flex flex-col justify-center bg-card/40">
             <Typography variant="h3" glow uppercase className="mb-2">
               {t('OPERATIONAL_SUMMARY')}
             </Typography>
             <Typography variant="body" color="muted" className="text-sm italic">
               {t('OPERATIONAL_SUMMARY_DESC')}
             </Typography>
             <div className="mt-6 flex gap-4">
               <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
                 <Typography variant="mono" className="text-[10px] uppercase font-bold text-cyber-green">
                   {t('ALL_SYSTEMS_NOMINAL')}
                 </Typography>
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-cyber-blue" />
                 <Typography variant="mono" className="text-[10px] uppercase font-bold text-cyber-blue">
                   {t('ACTIVE_PARALLEL_TRACES').replace('{count}', '8')}
                 </Typography>
               </div>
             </div>
           </div>
        </div>
      </section>

      {/* Main Workspace */}
      <div className="space-y-6">
        {/* Improved Tab Navigation */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                    ${
                      isActive
                        ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/30 shadow-premium'
                        : 'text-muted-more hover:text-foreground hover:bg-foreground/5 border border-transparent'
                    }
                  `}
                >
                  <Icon size={14} />
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`
                      ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black
                      ${isActive ? 'bg-cyber-blue/20 text-cyber-blue' : 'bg-foreground/10 text-muted-more'}
                    `}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          
          <Typography variant="mono" className="text-[10px] uppercase font-black opacity-20 tracking-[0.2em]">
            Collaboration_Matrix_v3.2.0
          </Typography>
        </div>

        {/* Dynamic Content Pane with Height Optimization */}
        <div className="min-h-[600px]">
          {activeTab === 'consensus' &&
            (isLoading ? (
              <div className="py-20 text-center animate-pulse">
                <Typography variant="mono" color="muted" className="text-xs uppercase tracking-widest">
                  {t('DECRYPTING_SWARM_STATE')}
                </Typography>
              </div>
            ) : (
              <SwarmConsensusView requests={requests} />
            ))}

          {activeTab === 'live' && (
            <div className="h-[700px] glass-card border-border overflow-hidden relative shadow-premium bg-card/40">
              <ReactFlowProvider>
                <CollaborationCanvas />
              </ReactFlowProvider>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
