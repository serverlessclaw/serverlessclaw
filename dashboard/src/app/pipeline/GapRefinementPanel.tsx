'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle, Users, ListFilter, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface SubTask {
  id: number | string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

interface EvolutionPlan {
  gapId: string;
  strategy: string;
  subTasks: SubTask[];
}

interface GapRefinementPanelProps {
  gapId: string;
  gapContent: string;
  currentImpact: number;
  currentPriority: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function GapRefinementPanel({
  gapId,
  gapContent,
  currentImpact,
  currentPriority,
  onClose,
  onSaved,
}: GapRefinementPanelProps) {
  const { t } = useTranslations();
  const [content, setContent] = useState(gapContent);
  const [impact, setImpact] = useState(currentImpact);
  const [priority, setPriority] = useState(currentPriority);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [error, setError] = useState('');
  
  const [plan, setPlan] = useState<EvolutionPlan | null>(null);

  // Fetch real plan from DynamoDB
  useEffect(() => {
    const fetchPlan = async () => {
      setLoadingPlan(true);
      try {
        const res = await fetch(`/api/memory/gap/plan?gapId=${gapId}`);
        if (!res.ok) throw new Error('Failed to fetch plan');
        const data = await res.json();
        if (data.plan) {
          setPlan(data.plan);
        }
      } catch (err) {
        console.error('Failed to load plan:', err);
      } finally {
        setLoadingPlan(false);
      }
    };
    fetchPlan();
  }, [gapId]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/memory/gap/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gapId: gapId.replace(/^GAP#/, ''),
          content: content !== gapContent ? content : undefined,
          impact: impact !== currentImpact ? impact : undefined,
          priority: priority !== currentPriority ? priority : undefined,
          plan: plan || undefined,
        }),
      });
      if (!res.ok) throw new Error(t('PIPELINE_SAVE_FAILED'));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('PIPELINE_SAVE_FAILED'));
    } finally {
      setSaving(false);
    }
  };

  const updateSubTask = (id: number | string, description: string) => {
    if (!plan) return;
    setPlan({
      ...plan,
      subTasks: plan.subTasks.map((st) => (st.id === id ? { ...st, description } : st)),
    });
  };

  const removeSubTask = (id: number | string) => {
    if (!plan) return;
    setPlan({
      ...plan,
      subTasks: plan.subTasks.filter((st) => st.id !== id),
    });
  };

  const addSubTask = () => {
    const newId = `new-${Date.now()}`;
    const newSubTask: SubTask = { id: newId, description: '', status: 'PENDING' };
    
    if (!plan) {
      setPlan({
        gapId: gapId.replace(/^GAP#/, ''),
        strategy: 'User defined strategy',
        subTasks: [newSubTask]
      });
    } else {
      setPlan({
        ...plan,
        subTasks: [...plan.subTasks, newSubTask],
      });
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      setError(t('PIPELINE_REJECTION_REQUIRED'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/memory/gap/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gapId: gapId.replace(/^GAP#/, ''),
          rejectionReason,
        }),
      });
      if (!res.ok) throw new Error(t('PIPELINE_REJECT_FAILED'));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('PIPELINE_REJECT_FAILED'));
    } finally {
      setSaving(false);
    }
  };

  const shortId = gapId.split('#').slice(-1)[0];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-background border-l border-border overflow-y-auto shadow-premium"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background/80 backdrop-blur-md border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">{t('PIPELINE_REFINE_GAP')}</h2>
            <p className="text-[10px] font-mono text-muted-more mt-0.5">ID: {shortId}</p>
          </div>
          <button onClick={onClose} className="text-muted-more hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Description */}
          <div>
            <label className="block text-[10px] font-bold text-muted-more uppercase tracking-wider mb-2">
              {t('PIPELINE_DESCRIPTION')}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full bg-input border border-input rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyber-green/50 resize-none transition-colors"
            />
          </div>

          {/* Evolution Plan Decomposition */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[10px] font-bold text-cyber-green/70 uppercase tracking-wider">
                <ListFilter size={12} /> {t('PIPELINE_PLAN_DECOMPOSITION')}
              </label>
              <button 
                onClick={addSubTask}
                className="text-[9px] font-bold text-muted-more hover:text-cyber-green transition-colors flex items-center gap-1 uppercase tracking-widest"
              >
                <Plus size={10} /> {t('PIPELINE_ADD_SUBTASK')}
              </button>
            </div>
            
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
              {loadingPlan ? (
                <div className="py-8 text-center animate-pulse text-[10px] text-muted-more uppercase font-mono tracking-widest">
                  {t('PIPELINE_LOADING_EVOLUTION_PLAN')}
                </div>
              ) : plan?.subTasks.length ? (
                plan.subTasks.map((st) => (
                  <div key={st.id} className="group relative">
                    <textarea
                      value={st.description}
                      onChange={(e) => updateSubTask(st.id, e.target.value)}
                      rows={2}
                      className="w-full bg-foreground/[0.02] border border-border rounded px-3 py-2 text-[11px] text-foreground/70 focus:outline-none focus:border-cyber-green/30 resize-none group-hover:bg-foreground/[0.04] transition-colors"
                    />
                    <button 
                      onClick={() => removeSubTask(st.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-red-500/50 hover:text-red-500 transition-all font-bold"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-4 text-center border border-dashed border-border rounded text-[10px] text-muted-more/40 uppercase tracking-widest italic">
                  {t('PIPELINE_NO_PLAN_GENERATED')}
                </div>
              )}
            </div>
          </div>

          {/* Impact + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-muted-more uppercase tracking-wider mb-2">
                {t('PIPELINE_IMPACT_LABEL')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={impact}
                onChange={(e) => setImpact(Number(e.target.value))}
                className="w-full bg-input border border-input rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyber-green/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted-more uppercase tracking-wider mb-2">
                {t('PIPELINE_PRIORITY_LABEL')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-input border border-input rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyber-green/50 transition-colors"
              />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-cyber-green/10 hover:bg-cyber-green/20 border border-cyber-green/30 text-cyber-green text-xs font-bold uppercase tracking-wider py-3 rounded flex items-center justify-center gap-2 transition-colors mt-auto"
          >
            <Save size={14} /> {saving ? t('PIPELINE_SAVING') : t('PIPELINE_AUTHORIZE_PLAN')}
          </button>

          {/* Swarm Consensus Section */}
          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-500 uppercase tracking-widest">
              <Users size={12} /> {t('PIPELINE_SWARM_CONSENSUS')}
            </div>
            <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[9px] text-muted uppercase">{t('PIPELINE_AGENT_AGREEMENT')}</span>
                <span className="text-[9px] text-cyber-green font-black">94%</span>
              </div>
              <div className="w-full h-1 bg-foreground/5 rounded-full overflow-hidden">
                <div className="h-full bg-cyber-green" style={{ width: '94%' }} />
              </div>
              <p className="text-[9px] text-muted-more mt-2 italic leading-tight">
                {t('PIPELINE_CONSENSUS_REACHED')}
              </p>
            </div>
          </div>

          {/* Reject section */}
          <div className="border-t border-border pt-4">
            {!showReject ? (
              <button
                onClick={() => setShowReject(true)}
                className="w-full text-red-500/60 hover:text-red-500 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors py-2"
              >
                <AlertTriangle size={12} /> {t('PIPELINE_REJECT_PLAN')}
              </button>
            ) : (
              <div className="space-y-3">
                <label className="block text-[10px] font-bold text-red-500 uppercase tracking-wider">
                  {t('PIPELINE_REJECTION_REASON_LABEL')}
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  placeholder={t('PIPELINE_REJECTION_REASON_PLACEHOLDER')}
                  className="w-full bg-red-500/5 border border-red-500/20 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-red-500 resize-none placeholder:text-muted-more/30"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowReject(false)}
                    className="flex-1 text-muted-more hover:text-foreground text-[10px] font-bold uppercase tracking-wider py-2 rounded border border-border transition-colors"
                  >
                    {t('COMMON_CANCEL')}
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={saving}
                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 text-[10px] font-bold uppercase tracking-wider py-2 rounded transition-colors"
                  >
                    {saving ? t('PIPELINE_REJECTING') : t('PIPELINE_CONFIRM_REJECT')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="text-red-400 text-[10px] font-mono bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
