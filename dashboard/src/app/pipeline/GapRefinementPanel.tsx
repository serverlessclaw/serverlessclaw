'use client';

import React, { useState } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';

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
  const [content, setContent] = useState(gapContent);
  const [impact, setImpact] = useState(currentImpact);
  const [priority, setPriority] = useState(currentPriority);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      setError('Rejection reason is required');
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
      if (!res.ok) throw new Error('Reject failed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setSaving(false);
    }
  };

  const shortId = gapId.split('#').slice(-1)[0];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-[#0a0a0a] border-l border-white/10 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0a0a0a] border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-sm font-bold text-white/90 uppercase tracking-wider">Refine Gap</h2>
            <p className="text-[10px] font-mono text-white/40 mt-0.5">ID: {shortId}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Description */}
          <div>
            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-2">
              Description
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white/90 focus:outline-none focus:border-cyber-green/50 resize-none"
            />
          </div>

          {/* Impact + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-2">
                Impact (1-10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={impact}
                onChange={(e) => setImpact(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white/90 focus:outline-none focus:border-cyber-green/50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-2">
                Priority (1-10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white/90 focus:outline-none focus:border-cyber-green/50"
              />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-cyber-green/10 hover:bg-cyber-green/20 border border-cyber-green/30 text-cyber-green text-xs font-bold uppercase tracking-wider py-2.5 rounded flex items-center justify-center gap-2 transition-colors"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save Refinement'}
          </button>

          {/* Reject section */}
          <div className="border-t border-white/10 pt-4">
            {!showReject ? (
              <button
                onClick={() => setShowReject(true)}
                className="w-full text-red-400/70 hover:text-red-400 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
              >
                <AlertTriangle size={12} /> Reject This Plan
              </button>
            ) : (
              <div className="space-y-3">
                <label className="block text-[10px] font-bold text-red-400/70 uppercase tracking-wider">
                  Rejection Reason (becomes a Tactical Lesson)
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this plan should be rejected..."
                  className="w-full bg-red-500/5 border border-red-500/20 rounded px-3 py-2 text-xs text-white/90 focus:outline-none focus:border-red-500/50 resize-none placeholder:text-white/20"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowReject(false)}
                    className="flex-1 text-white/40 hover:text-white/70 text-[10px] font-bold uppercase tracking-wider py-2 rounded border border-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={saving}
                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase tracking-wider py-2 rounded transition-colors"
                  >
                    {saving ? 'Rejecting...' : 'Confirm Reject'}
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
