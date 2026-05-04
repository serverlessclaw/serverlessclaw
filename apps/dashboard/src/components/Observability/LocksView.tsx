'use client';

import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Clock, ShieldAlert, Zap, RefreshCw } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

interface LockItem {
  lockId: string;
  rawId: string;
  expiresAt: number;
  acquiredAt: number;
  isExpired: boolean;
}

export default function LocksView() {
  const [locks, setLocks] = useState<LockItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLocks = () => {
    fetch('/api/locks')
      .then((res) => res.json())
      .then((data) => setLocks(data.locks ?? []))
      .catch(() => setLocks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLocks();
    const interval = setInterval(fetchLocks, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRelease = async (lockId: string) => {
    try {
      await fetch(`/api/locks?lockId=${encodeURIComponent(lockId)}`, { method: 'DELETE' });
      fetchLocks();
    } catch (e) {
      console.error('Failed to release lock', e);
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <Typography
          variant="caption"
          weight="black"
          className="tracking-[0.2em] flex items-center gap-2"
        >
          <Zap size={14} className="text-orange-500" /> Lane Concurrency Monitor
        </Typography>
        <div className="flex items-center gap-2">
          <RefreshCw size={10} className="animate-spin-slow text-muted-foreground/40" />
          <Typography variant="mono" color="muted" className="text-[10px] uppercase">
            Auto-Refresh Active
          </Typography>
        </div>
      </div>

      <div className="grid gap-4">
        {locks.length > 0 ? (
          locks.map((lock, i) => (
            <Card
              key={i}
              variant="glass"
              padding="lg"
              className={`flex justify-between items-center border-l-4 transition-all bg-card/60 ${
                lock.isExpired ? 'border-l-border opacity-60' : 'border-l-orange-500 shadow-premium'
              }`}
            >
              <div className="flex gap-6 items-center">
                <div
                  className={`w-10 h-10 rounded flex items-center justify-center ${
                    lock.isExpired
                      ? 'bg-foreground/5 text-muted-foreground'
                      : 'bg-orange-500/10 text-orange-500'
                  }`}
                >
                  <Lock size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <Typography variant="caption" weight="bold">
                      SESSION::{lock.lockId}
                    </Typography>
                    {lock.isExpired && (
                      <Badge variant="danger" className="text-[9px] px-1.5 py-0.5">
                        Expired
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-6 mt-2">
                    <Typography
                      variant="mono"
                      color="muted"
                      className="flex items-center gap-1.5 text-[10px]"
                    >
                      <Clock size={12} /> Acquired:{' '}
                      {new Date(lock.acquiredAt * 1000).toLocaleTimeString()}
                    </Typography>
                    <Typography
                      variant="mono"
                      color="muted"
                      className="flex items-center gap-1.5 text-[10px]"
                    >
                      <ShieldAlert size={12} /> TTL:{' '}
                      {new Date(lock.expiresAt * 1000).toLocaleTimeString()}
                    </Typography>
                  </div>
                </div>
              </div>

              <Button
                variant="danger"
                size="sm"
                onClick={() => handleRelease(lock.rawId)}
                icon={<Unlock size={14} />}
              >
                Force Release
              </Button>
            </Card>
          ))
        ) : (
          <div className="h-48 flex flex-col items-center justify-center opacity-20 border-dashed border-2 border-border rounded-xl">
            <Unlock size={32} className="mb-4 text-muted-foreground" />
            <Typography variant="body" color="muted">
              All lanes clear // No active sessions
            </Typography>
          </div>
        )}
      </div>

      <Card
        variant="outline"
        padding="lg"
        className="border-orange-500/10 bg-orange-500/[0.02] max-w-2xl"
      >
        <Typography
          variant="caption"
          weight="bold"
          className="text-orange-500 mb-2 flex items-center gap-2"
        >
          <ShieldAlert size={12} /> Recovery Protocol
        </Typography>
        <Typography variant="body" italic className="text-[11px] leading-relaxed opacity-70 block">
          &quot;Ghost Locks&quot; occur when an agent crashes before releasing its session. Force
          releasing a lock allows the user to start a new session immediately. Caution: Releasing an
          active lock may cause state secondary inconsistencies.
        </Typography>
      </Card>
    </div>
  );
}
