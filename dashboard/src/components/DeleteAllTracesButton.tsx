'use client';

import React, { useState } from 'react';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DeleteAllTracesButton() {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch('/api/trace?traceId=all', {
        method: 'DELETE',
      });

      if (response.ok) {
        setShowConfirm(false);
        router.refresh();
      } else {
        const error = await response.json();
        alert(`Failed to purge traces: ${error.error}`);
      }
    } catch (error) {
      console.error('Delete all traces error:', error);
      alert('Failed to purge traces.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="glass-card px-4 py-2.5 text-[11px] lg:text-[12px] border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2"
        title="Purge All Traces"
      >
        <Trash2 size={14} />
        <span className="font-bold tracking-widest text-[9px]">PURGE_ALL_TRACES</span>
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
          <div className="relative w-full max-w-md bg-[#0a0a0a] border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.1)] rounded-sm p-8 space-y-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                <AlertTriangle size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-black uppercase tracking-[0.2em] text-white">Purge Entire Archive?</h3>
                <p className="text-xs text-white/60 leading-relaxed font-mono">
                  You are about to permanently erase ALL neural execution traces from the database. This will eliminate the entire historical logic record.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                disabled={isDeleting}
                onClick={handleDeleteAll}
                className="flex-1 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/50 py-3 rounded-sm text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2"
              >
                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : 'CONFIRM_TOTAL_PURGE'}
              </button>
              <button
                disabled={isDeleting}
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 border border-white/10 py-3 rounded-sm text-[10px] font-black uppercase tracking-[0.2em] transition-all"
              >
                ABORT_ACTION
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
