'use client';

import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';

interface ExportButtonProps {
  sessionId: string;
  sessionTitle: string;
}

export default function ExportButton({ sessionId, sessionTitle }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsExporting(true);
    try {
      const res = await fetch(`/api/chat?sessionId=${sessionId}`);
      if (!res.ok) throw new Error('Failed to fetch session history');

      const data = await res.json();
      const exportData = {
        sessionId,
        title: sessionTitle,
        exportedAt: new Date().toISOString(),
        messages: data.history || [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${sessionId}-${new Date().getTime()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Session exported successfully');
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Failed to export session');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleExport}
      disabled={isExporting}
      className="p-1.5 text-white/40 hover:text-cyber-blue transition-colors bg-white/5 hover:bg-cyber-blue/10 rounded"
      title="Export Session as JSON"
      icon={isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
    />
  );
}
