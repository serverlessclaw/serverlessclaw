'use client';

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import CyberConfirm from './CyberConfirm';

interface DeleteTraceButtonProps {
  traceId: string;
}

export default function DeleteTraceButton({ traceId }: DeleteTraceButtonProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = async () => {
    setShowConfirm(false);
    try {
      const response = await fetch(`/api/trace?traceId=${traceId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('Neural trace deleted');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(`Failed to delete trace: ${error.error}`);
      }
    } catch (error) {
      console.error('Delete trace error:', error);
      toast.error('Failed to delete trace.');
    }
  };

  return (
    <>
      <CyberConfirm 
        isOpen={showConfirm}
        title="Trace Erasure"
        message="Are you sure you want to permanently delete this neural trace? This action cannot be reversed."
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowConfirm(true);
        }}
        className="p-2 opacity-0 group-hover:opacity-40 hover:!opacity-100 text-white transition-all hover:text-red-500 z-10"
        title="Delete Trace"
      >
        <Trash2 size={16} />
      </button>
    </>
  );
}
