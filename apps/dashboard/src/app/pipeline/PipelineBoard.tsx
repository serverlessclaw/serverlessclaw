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
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import Badge from '@/components/ui/Badge';
import { GapStatus } from '@claw/core/lib/types';
import { GapItem } from '@claw/core/lib/types/memory';
import CyberConfirm from '@/components/CyberConfirm';
import GapRefinementPanel from './GapRefinementPanel';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface PipelineBoardProps {
  initialGaps: GapItem[];
  updateStatus: (gapId: string, status: string) => Promise<void>;
  pruneGap: (gapId: string, timestamp: number | string) => Promise<void>;
  triggerBatchEvolution: (gapIds: string[]) => Promise<void>;
}

export default function PipelineBoard({
  initialGaps,
  updateStatus,
  pruneGap,
  triggerBatchEvolution,
}: PipelineBoardProps) {
  const { t } = useTranslations();
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<string | null>(null);
  const [refiningGapId, setRefiningGapId] = useState<string | null>(null);
  const [pruneTarget, setPruneTarget] = useState<{
    gapId: string;
    timestamp: number | string;
  } | null>(null);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

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

  const handlePrune = async (gapId: string, timestamp: number | string) => {
    setPruneTarget({ gapId, timestamp });
  };

  const confirmPrune = async () => {
    if (!pruneTarget) return;
    const { gapId, timestamp } = pruneTarget;
    setPruneTarget(null);

    setProcessing(gapId);
    try {
      await pruneGap(gapId, timestamp);
      toast.success(t('PIPELINE_PRUNED_SUCCESS'));
    } catch {
      toast.error(t('PIPELINE_PRUNE_ERROR'));
    } finally {
      setProcessing(null);
    }
  };

  const handleBatchEvolution = async () => {
    const readyGaps = initialGaps.filter(
      (g) => g.status === GapStatus.PLANNED && selectedGaps.has(g.userId)
    );
    if (readyGaps.length === 0) {
      toast.warning(t('PIPELINE_BATCH_EVOLVE_WARNING'));
      return;
    }

    setShowBatchConfirm(true);
  };

  const confirmBatchEvolution = async () => {
    const readyGaps = initialGaps.filter(
      (g) => g.status === GapStatus.PLANNED && selectedGaps.has(g.userId)
    );
    setShowBatchConfirm(false);

    setProcessing('batch');
    try {
      await triggerBatchEvolution(readyGaps.map((g) => g.userId));
      setSelectedGaps(new Set());
      toast.success(
        t('PIPELINE_BATCH_EVOLVE_SUCCESS').replace('{count}', String(readyGaps.length))
      );
    } catch {
      toast.error(t('PIPELINE_BATCH_EVOLVE_ERROR'));
    } finally {
      setProcessing(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, gapId: string) => {
    e.dataTransfer.setData('gapId', gapId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: GapStatus) => {
    e.preventDefault();
    const gapId = e.dataTransfer.getData('gapId');
    const gap = initialGaps.find((g) => g.userId === gapId);

    if (gap && gap.status !== targetStatus) {
      await handleUpdateStatus(gapId, targetStatus);
    }
  };

  const handleSelectAllInColumn = (status: GapStatus) => {
    const colGaps = initialGaps.filter((g) => g.status === status);
    const newSelection = new Set(selectedGaps);
    const allSelected = colGaps.every((g) => selectedGaps.has(g.userId));

    if (allSelected) {
      colGaps.forEach((g) => newSelection.delete(g.userId));
    } else {
      colGaps.forEach((g) => newSelection.add(g.userId));
    }
    setSelectedGaps(newSelection);
  };

  const columns = [
    {
      status: GapStatus.OPEN,
      label: t('PIPELINE_COL_IDENTIFIED'),
      icon: Target,
      color: 'text-amber-500',
      glow: 'shadow-[0_0_15px_rgba(245,158,11,0.2)]',
    },
    {
      status: GapStatus.PLANNED,
      label: t('PIPELINE_COL_READY'),
      icon: Brain,
      color: 'text-indigo-500',
      glow: 'shadow-[0_0_15px_rgba(99,102,241,0.2)]',
    },
    {
      status: GapStatus.PROGRESS,
      label: t('PIPELINE_COL_EVOLUTION'),
      icon: GitBranch,
      color: 'text-cyber-blue',
      glow: 'shadow-[0_0_15px_rgba(59,130,246,0.2)]',
    },
    {
      status: GapStatus.DEPLOYED,
      label: t('PIPELINE_COL_VERIFIED'),
      icon: Rocket,
      color: 'text-purple-500',
      glow: 'shadow-[0_0_15px_rgba(168,85,247,0.2)]',
    },
    {
      status: GapStatus.DONE,
      label: t('PIPELINE_COL_CLOSED'),
      icon: CheckCircle2,
      color: 'text-cyber-green',
      glow: 'shadow-[0_0_15px_rgba(34,197,94,0.2)]',
    },
    {
      status: GapStatus.FAILED,
      label: t('PIPELINE_COL_FAILED'),
      icon: Trash2,
      color: 'text-red-500',
      glow: 'shadow-[0_0_15px_rgba(239,68,68,0.2)]',
    },
  ];

  return (
    <>
      <div className="grid grid-cols-6 gap-6 h-[calc(100vh-250px)]">
        {columns.map((col) => {
          const colGaps = initialGaps.filter((g) => g.status === col.status);
          const Icon = col.icon;
          const selectedCount = colGaps.filter((g) => selectedGaps.has(g.userId)).length;

          return (
            <div
              key={col.status}
              className="flex flex-col gap-4"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.status)}
            >
              <div className={`flex flex-col p-3 glass-card border-border bg-card/50 ${col.glow}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon size={16} className={col.color} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
                      {col.label}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-more">{colGaps.length}</span>
                </div>

                {colGaps.length > 0 && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                    <button
                      onClick={() => handleSelectAllInColumn(col.status)}
                      className="flex items-center gap-1.5 text-[8px] uppercase font-bold text-muted hover:text-foreground transition-colors"
                    >
                      {colGaps.every((g) => selectedGaps.has(g.userId)) ? (
                        <CheckSquare size={10} />
                      ) : (
                        <Square size={10} />
                      )}
                      {selectedCount > 0
                        ? t('PIPELINE_SELECTED_COUNT').replace('{count}', String(selectedCount))
                        : t('PIPELINE_SELECT_ALL')}
                    </button>

                    {col.status === GapStatus.PLANNED && selectedCount > 0 && (
                      <button
                        onClick={handleBatchEvolution}
                        disabled={processing === 'batch'}
                        className="flex items-center gap-1 text-[8px] uppercase font-black text-indigo-400 hover:text-indigo-300 animate-pulse disabled:opacity-50"
                      >
                        <Play size={10} fill="currentColor" /> {t('PIPELINE_TRIGGER_BATCH')}
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
                      data-testid="gap-card"
                      draggable={!processing}
                      onDragStart={(e) => handleDragStart(e, gap.userId)}
                      className={`glass-card gap-card pt-3 pl-3 pr-3 pb-2 border-border hover:border-border/50 transition-all group relative overflow-hidden bg-card/60 ${selectedGaps.has(gap.userId) ? 'ring-1 ring-indigo-500/50 bg-indigo-500/10' : ''} ${processing === gap.userId ? 'opacity-50 cursor-wait' : 'cursor-grab active:cursor-grabbing'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSelection(gap.userId)}
                            className="text-muted-more hover:text-foreground transition-colors"
                          >
                            {selectedGaps.has(gap.userId) ? (
                              <CheckSquare size={12} className="text-indigo-500" />
                            ) : (
                              <Square size={12} />
                            )}
                          </button>
                          <div className="text-[8px] font-mono text-muted-more uppercase">
                            ID: {gap.userId.split('#').slice(-1)[0]}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5 text-[7px] text-muted-more uppercase font-black">
                            <span className="flex items-center gap-0.5">
                              <TrendingUp size={7} className="text-cyber-green" />{' '}
                              {gap.metadata?.impact ?? 5}
                            </span>
                            <span className="flex items-center gap-0.5">
                              <Brain size={7} className="text-amber-500" />{' '}
                              {gap.metadata?.priority ?? 5}
                            </span>
                          </div>
                          {processing === gap.userId ? (
                            <div className="w-1.5 h-1.5 rounded-full bg-cyber-blue animate-spin"></div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {gap.status === 'FAILED' && (
                                <Badge variant="danger" className="text-[7px] px-1 py-0 uppercase">
                                  {gap.status}
                                </Badge>
                              )}
                              <button
                                onClick={() => handlePrune(gap.userId, gap.timestamp)}
                                className="opacity-0 group-hover:opacity-100 text-muted-more hover:text-red-500 transition-all"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="relative">
                        <p
                          className={`text-[11px] text-foreground leading-relaxed font-medium mb-2 ${isExpanded ? '' : 'line-clamp-3'}`}
                        >
                          {gap.content}
                        </p>
                        <button
                          onClick={() => toggleExpand(gap.userId)}
                          className="text-[8px] text-cyber-blue/60 hover:text-cyber-blue uppercase font-bold flex items-center gap-0.5 mb-2 transition-colors"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={10} /> {t('PIPELINE_SHOW_LESS')}
                            </>
                          ) : (
                            <>
                              <ChevronDown size={10} /> {t('PIPELINE_SHOW_MORE')}
                            </>
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border">
                        <div className="flex items-center gap-2 text-[8px] text-muted-more font-mono">
                          <Clock size={8} />
                          {new Date(gap.timestamp).toLocaleDateString()}
                        </div>

                        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {columns.find((c) => {
                            const currentIndex = columns.findIndex(
                              (col) => col.status === gap.status
                            );
                            return columns.indexOf(c) === currentIndex + 1;
                          }) && (
                            <button
                              onClick={() =>
                                handleUpdateStatus(
                                  gap.userId,
                                  columns[columns.findIndex((c) => c.status === gap.status) + 1]
                                    .status
                                )
                              }
                              disabled={!!processing}
                              className="cursor-pointer text-[8px] font-bold bg-foreground/5 hover:bg-foreground/10 px-2 py-1 rounded flex items-center gap-1 transition-colors uppercase tracking-tight text-foreground/80 hover:text-foreground"
                            >
                              {t('PIPELINE_ADVANCE')} <ArrowRight size={8} />
                            </button>
                          )}
                          {gap.status !== columns[0].status && (
                            <button
                              onClick={() =>
                                handleUpdateStatus(
                                  gap.userId,
                                  columns[columns.findIndex((c) => c.status === gap.status) - 1]
                                    .status
                                )
                              }
                              disabled={!!processing}
                              className="cursor-pointer text-[8px] font-bold text-muted hover:text-foreground px-2 py-1 transition-colors uppercase tracking-tight"
                            >
                              {t('PIPELINE_REVERT')}
                            </button>
                          )}
                          <button
                            onClick={() => setRefiningGapId(gap.userId)}
                            className="cursor-pointer text-[8px] font-bold text-cyber-blue/60 hover:text-cyber-blue px-2 py-1 transition-colors uppercase tracking-tight"
                          >
                            {t('PIPELINE_REFINE')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {colGaps.length === 0 && (
                  <div className="h-32 flex items-center justify-center text-muted-more/20 border border-dashed border-border rounded-lg">
                    <span className="text-[9px] uppercase tracking-widest font-bold">
                      {t('PIPELINE_TERMINAL_EMPTY')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {refiningGapId && (
        <GapRefinementPanel
          gapId={refiningGapId}
          gapContent={initialGaps.find((g) => g.userId === refiningGapId)?.content ?? ''}
          currentImpact={initialGaps.find((g) => g.userId === refiningGapId)?.metadata?.impact ?? 5}
          currentPriority={
            initialGaps.find((g) => g.userId === refiningGapId)?.metadata?.priority ?? 5
          }
          onClose={() => setRefiningGapId(null)}
          onSaved={() => {
            setRefiningGapId(null);
            window.location.reload();
          }}
        />
      )}
      <CyberConfirm
        isOpen={!!pruneTarget}
        title={t('PIPELINE_PRUNE_GAP_TITLE')}
        message={t('PIPELINE_PRUNE_GAP_MESSAGE')}
        variant="danger"
        confirmText={t('PIPELINE_CONFIRM_PRUNE')}
        onConfirm={confirmPrune}
        onCancel={() => setPruneTarget(null)}
      />
      <CyberConfirm
        isOpen={showBatchConfirm}
        title={t('PIPELINE_INITIATE_EVOLUTION')}
        message={t('PIPELINE_BATCH_EVOLVE_MESSAGE').replace(
          '{count}',
          String(
            initialGaps.filter((g) => g.status === GapStatus.PLANNED && selectedGaps.has(g.userId))
              .length
          )
        )}
        variant="warning"
        confirmText={t('PIPELINE_INITIATE_EVOLUTION')}
        onConfirm={confirmBatchEvolution}
        onCancel={() => setShowBatchConfirm(false)}
      />
    </>
  );
}
