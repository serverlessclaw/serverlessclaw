'use client';

import React, { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import CyberConfirm from './CyberConfirm';
import Button from './ui/Button';

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
        confirmText={isDeleting ? 'Purging...' : 'Confirm Total Purge'}
        onConfirm={handleDeleteAll}
        onCancel={() => setShowConfirm(false)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={isDeleting}
        onClick={() => setShowConfirm(true)}
        className="border-red-500/30 text-red-500 hover:bg-red-500/10"
        icon={isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        title="Purge All Traces"
      >
        Purge All Traces
      </Button>
    </>
  );
}
