'use client';

import React, { useEffect, useState } from 'react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { GitBranch, CheckCircle2, XCircle, Loader2, Link2 } from 'lucide-react';

interface SyncRecord {
  buildId: string;
  status: 'PROGRESS' | 'SUCCESS' | 'FAILED';
  gapIds: string[];
  timestamp: number;
  commitHash?: string;
}

export default function DeploySyncStatus() {
  const [syncs, setSyncs] = useState<SyncRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSyncs() {
      try {
        const res = await fetch('/api/infra/sync-status');
        const data = await res.json();
        setSyncs(data.syncs || []);
      } catch (e) {
        console.error('Failed to fetch sync status:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSyncs();
    const interval = setInterval(fetchSyncs, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-cyber-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <GitBranch size={18} className="text-cyber-blue" />
        <Typography variant="h3" uppercase glow>
          Deployment Sync Tracker
        </Typography>
      </div>

      <div className="space-y-3">
        {syncs.map((sync) => (
          <div
            key={sync.buildId}
            className="bg-white/5 border border-white/10 p-4 rounded-lg flex items-center justify-between hover:border-white/20 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div
                className={
                  sync.status === 'SUCCESS'
                    ? 'text-cyber-green'
                    : sync.status === 'FAILED'
                      ? 'text-red-500'
                      : 'text-cyber-blue'
                }
              >
                {sync.status === 'SUCCESS' && <CheckCircle2 size={20} />}
                {sync.status === 'FAILED' && <XCircle size={20} />}
                {sync.status === 'PROGRESS' && <Loader2 size={20} className="animate-spin" />}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Typography variant="mono" className="text-sm font-bold">
                    {sync.buildId.slice(0, 12)}
                  </Typography>
                  <Badge
                    variant={
                      sync.status === 'SUCCESS'
                        ? 'primary'
                        : sync.status === 'FAILED'
                          ? 'danger'
                          : 'intel'
                    }
                    className="text-[9px] px-2 py-0"
                  >
                    {sync.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1 opacity-40">
                    <Link2 size={10} />
                    <Typography variant="mono" className="text-[10px]">
                      {sync.gapIds.length} GAPS
                    </Typography>
                  </div>
                  <Typography variant="mono" className="text-[10px] opacity-20">
                    {new Date(sync.timestamp).toLocaleTimeString()}
                  </Typography>
                </div>
              </div>
            </div>

            <div className="flex gap-1">
              {sync.gapIds.map((id) => (
                <div key={id} className="w-2 h-2 rounded-full bg-cyber-blue/40" title={id} />
              ))}
            </div>
          </div>
        ))}

        {syncs.length === 0 && (
          <div className="text-center py-10 opacity-40 italic">
            <Typography variant="body">No recent deployment syncs recorded.</Typography>
          </div>
        )}
      </div>
    </div>
  );
}
