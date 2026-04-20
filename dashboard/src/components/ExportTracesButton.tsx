'use client';

import React from 'react';
import { Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';
import { logger } from '@claw/core/lib/logger';

import { Trace } from '@/lib/types/ui';

interface ExportTracesButtonProps {
  traces: Trace[];
}

export default function ExportTracesButton({ traces }: ExportTracesButtonProps) {
  const handleExport = () => {
    try {
      if (!traces || traces.length === 0) {
        toast.error('No traces to export');
        return;
      }

      const exportData = {
        exportedAt: new Date().toISOString(),
        totalTraces: traces.length,
        traces,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `traces-${new Date().getTime()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${traces.length} traces exported successfully`);
    } catch (err) {
      logger.error('Export failed:', err);
      toast.error('Failed to export traces');
    }
  };

  return (
    <div className="flex flex-col items-center">
      <Typography
        variant="mono"
        color="muted"
        className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
      >
        EXPORT
      </Typography>
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        className="h-[26px] px-4 py-1 font-bold text-[10px] border-cyber-green/20 text-cyber-green/60 uppercase hover:bg-cyber-green/5"
        icon={<Download size={12} />}
      >
        JSON
      </Button>
    </div>
  );
}

// Helper to use Typography since it's not imported in this snippet
import Typography from '@/components/ui/Typography';
