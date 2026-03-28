'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Button from './ui/Button';

interface DeleteTraceButtonProps {
  traceId: string;
}

export default function DeleteTraceButton({ traceId }: DeleteTraceButtonProps) {
  const router = useRouter();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-white transition-all hover:text-red-500 z-10 p-2"
      icon={<Trash2 size={16} />}
      title="Delete Trace"
    />
  );
}
