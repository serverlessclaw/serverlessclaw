'use client';

import React, { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import CyberConfirm from './CyberConfirm';

export default function DeleteAllTracesButton() {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    setShowConfirm(false);
    try {
      const response = await fetch('/api/trace?traceId=all', {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('Neural archive purged successfully');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(`Failed to purge traces: ${error.error}`);
      }
    } catch (error) {
      console.error('Delete all traces error:', error);
      toast.error('Failed to purge traces.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <CyberConfirm 
        isOpen={showConfirm}
        title="Total Archive Purge"
        message="You are about to permanently erase ALL neural execution traces from the database. This will eliminate the entire historical logic record."
        variant="danger"
        confirmText={isDeleting ? 'PURGING...' : 'CONFIRM_TOTAL_PURGE'}
        onConfirm={handleDeleteAll}
        onCancel={() => setShowConfirm(false)}
      />
      <button
        disabled={isDeleting}
        onClick={() => setShowConfirm(true)}
        className="glass-card px-4 py-2.5 text-[11px] lg:text-[12px] border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-50"
        title="Purge All Traces"
      >
        {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        <span className="font-bold tracking-widest text-[9px]">PURGE_ALL_TRACES</span>
      </button>
    </>
  );
}
