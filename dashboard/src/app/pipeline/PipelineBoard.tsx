'use client';

import React, { useState } from 'react';
import { 
  GitBranch, 
  Target, 
  Rocket, 
  CheckCircle2, 
  Clock,
  ArrowRight,
  TrendingUp,
  Brain,
  Trash2,
  Play,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { GapStatus } from '@claw/core/lib/types';

interface GapItem {
  userId: string;
  timestamp: number;
  content: string;
  status: GapStatus;
  metadata?: {
    impact?: number;
    priority?: number;
  };
}

interface PipelineBoardProps {
  initialGaps: GapItem[];
  updateStatus: (gapId: string, status: string) => Promise<void>;
  pruneGap: (gapId: string, timestamp: number) => Promise<void>;
  triggerBatchEvolution: (gapIds: string[]) => Promise<void>;
}

export default function PipelineBoard({ 
  initialGaps, 
  updateStatus, 
  pruneGap, 
  triggerBatchEvolution 
}: PipelineBoardProps) {
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<string | null>(null);

  const toggleSelection = (gapId: string) => {
    const newSelection = new Set(selectedGaps);
    if (newSelection.has(gapId)) {
      newSelection.delete(gapId);
    } else {
      newSelection.add(gapId);
    }
    setSelectedGaps(newSelection);
  };

  const toggleExpand = (gapId: string) => {
    const newExpanded = new Set(expandedGaps);
    if (newExpanded.has(gapId)) {
      newExpanded.delete(gapId);
    } else {
      newExpanded.add(gapId);
    }
    setExpandedGaps(newExpanded);
  };

  const handleUpdateStatus = async (gapId: string, status: string) => {
    setProcessing(gapId);
    try {
      await updateStatus(gapId, status);
    } finally {
      setProcessing(null);
    }
  };

  const handlePrune = async (gapId: string, timestamp: number) => {
    // eslint-disable-next-line no-alert
    if (!confirm('Are you sure you want to delete this gap? This action cannot be undone.')) return;
    setProcessing(gapId);
    try {
      await pruneGap(gapId, timestamp);
    } finally {
      setProcessing(null);
    }
  };

  const handleBatchEvolution = async () => {
    const readyGaps = initialGaps.filter(g => g.status === GapStatus.PLANNED && selectedGaps.has(g.userId));
    if (readyGaps.length === 0) {
        // eslint-disable-next-line no-alert
        alert('Please select at least one READY gap to evolve.');
        return;
    }
    
    // eslint-disable-next-line no-alert
    if (!confirm(`Trigger evolution for ${readyGaps.length} gaps?`)) return;
    
    setProcessing('batch');
    try {
      await triggerBatchEvolution(readyGaps.map(g => g.userId));
      setSelectedGaps(new Set());
    } finally {
      setProcessing(null);
    }
  };

  const handleSelectAllInColumn = (status: GapStatus) => {
    const colGaps = initialGaps.filter(g => g.status === status);
    const newSelection = new Set(selectedGaps);
    const allSelected = colGaps.every(g => selectedGaps.has(g.userId));
    
    if (allSelected) {
      colGaps.forEach(g => newSelection.delete(g.userId));
    } else {
      colGaps.forEach(g => newSelection.add(g.userId));
    }
    setSelectedGaps(newSelection);
  };

  const columns = [
    { status: GapStatus.OPEN, label: 'Identified', icon: Target, color: 'text-amber-500', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.2)]' },
    { status: GapStatus.PLANNED, label: 'Ready', icon: Brain, color: 'text-indigo-500', glow: 'shadow-[0_0_15px_rgba(99,102,241,0.2)]' },
    { status: GapStatus.PROGRESS, label: 'Evolution', icon: GitBranch, color: 'text-cyber-blue', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.2)]' },
    { status: GapStatus.DEPLOYED, label: 'Verified', icon: Rocket, color: 'text-purple-500', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.2)]' },
    { status: GapStatus.DONE, label: 'Closed', icon: CheckCircle2, color: 'text-cyber-green', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.2)]' },
  ];

  return (
    <div className="grid grid-cols-5 gap-6 h-[calc(100vh-250px)]">
      {columns.map((col) => {
        const colGaps = initialGaps.filter(g => g.status === col.status);
        const Icon = col.icon;
        const selectedCount = colGaps.filter(g => selectedGaps.has(g.userId)).length;

        return (
          <div key={col.status} className="flex flex-col gap-4">
            <div className={`flex flex-col p-3 glass-card border-white/5 bg-white/5 ${col.glow}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon size={16} className={col.color} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{col.label}</span>
                </div>
                <span className="text-[10px] font-mono text-white/40">{colGaps.length}</span>
              </div>
              
              {colGaps.length > 0 && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                   <button 
                    onClick={() => handleSelectAllInColumn(col.status)}
                    className="flex items-center gap-1.5 text-[8px] uppercase font-bold text-white/30 hover:text-white/60 transition-colors"
                   >
                     {colGaps.every(g => selectedGaps.has(g.userId)) ? <CheckSquare size={10} /> : <Square size={10} />}
                     {selectedCount > 0 ? `Selected ${selectedCount}` : 'Select All'}
                   </button>

                   {col.status === GapStatus.PLANNED && selectedCount > 0 && (
                     <button 
                        onClick={handleBatchEvolution}
                        disabled={processing === 'batch'}
                        className="flex items-center gap-1 text-[8px] uppercase font-black text-indigo-400 hover:text-indigo-300 animate-pulse disabled:opacity-50"
                     >
                        <Play size={10} fill="currentColor" /> Trigger Batch
                     </button>
                   )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar pb-10">
              {colGaps.map((gap) => {
                const isExpanded = expandedGaps.has(gap.userId);
                return (
                  <div 
                      key={gap.userId} 
                      className={`glass-card p-4 border-white/5 hover:border-white/20 transition-all group relative overflow-hidden bg-black/40 ${selectedGaps.has(gap.userId) ? 'ring-1 ring-indigo-500/50 bg-indigo-500/5' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                          <button onClick={() => toggleSelection(gap.userId)} className="text-white/20 hover:text-white/60 transition-colors">
                              {selectedGaps.has(gap.userId) ? <CheckSquare size={12} className="text-indigo-500" /> : <Square size={12} />}
                          </button>
                          <div className="text-[8px] font-mono text-white/30 uppercase">ID: {gap.userId.split('#').slice(-1)[0]}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1.5 text-[7px] text-white/20 uppercase font-black">
                            <span className="flex items-center gap-0.5"><TrendingUp size={7} className="text-cyber-green" /> {gap.metadata?.impact ?? 5}</span>
                            <span className="flex items-center gap-0.5"><Brain size={7} className="text-amber-500" /> {gap.metadata?.priority ?? 5}</span>
                        </div>
                        {processing === gap.userId ? (
                          <div className="w-1.5 h-1.5 rounded-full bg-cyber-blue animate-spin"></div>
                        ) : (
                          <button 
                              onClick={() => handlePrune(gap.userId, gap.timestamp)}
                              className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-500 transition-all"
                          >
                              <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <div className="relative">
                        <p className={`text-[11px] text-white/100 leading-relaxed font-medium mb-2 ${isExpanded ? '' : 'line-clamp-3'}`}>
                        {gap.content}
                        </p>
                        <button 
                            onClick={() => toggleExpand(gap.userId)}
                            className="text-[8px] text-cyber-blue/60 hover:text-cyber-blue uppercase font-bold flex items-center gap-0.5 mb-2 transition-colors"
                        >
                            {isExpanded ? <><ChevronUp size={10} /> Show Less</> : <><ChevronDown size={10} /> Show Full Detail</>}
                        </button>
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
                      <div className="flex items-center gap-2 text-[8px] text-white/30 font-mono">
                        <Clock size={8} />
                        {new Date(gap.timestamp).toLocaleDateString()}
                      </div>
                      
                      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {columns.find(c => {
                          const currentIndex = columns.findIndex(col => col.status === gap.status);
                          return columns.indexOf(c) === currentIndex + 1;
                        }) && (
                          <button 
                              onClick={() => handleUpdateStatus(gap.userId, columns[columns.findIndex(c => c.status === gap.status) + 1].status)}
                              disabled={!!processing}
                              className="cursor-pointer text-[8px] font-bold bg-white/10 hover:bg-white/20 px-2 py-1 rounded flex items-center gap-1 transition-colors uppercase tracking-tight"
                          >
                              Advance <ArrowRight size={8} />
                          </button>
                        )}
                        {gap.status !== columns[0].status && (
                          <button 
                              onClick={() => handleUpdateStatus(gap.userId, columns[columns.findIndex(c => c.status === gap.status) - 1].status)}
                              disabled={!!processing}
                              className="cursor-pointer text-[8px] font-bold text-white/40 hover:text-white/80 px-2 py-1 transition-colors uppercase tracking-tight"
                          >
                              Revert
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {colGaps.length === 0 && (
                <div className="h-32 flex items-center justify-center text-white/5 border border-dashed border-white/5 rounded-lg">
                  <span className="text-[9px] uppercase tracking-widest font-bold">Terminal Empty</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
