'use client';

import React from 'react';
import { ShieldCheck, Clock } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface ResilienceLog {
  timestamp?: number;
  key?: string;
  value?: string;
  content?: string;
}

interface ResilienceLogsCardProps {
  logs: ResilienceLog[];
}

export default function ResilienceLogsCard({ logs }: ResilienceLogsCardProps) {
  const { t } = useTranslations();

  return (
    <div className="lg:col-span-2">
      <Card variant="solid" padding="lg" className="space-y-4 border-white/5">
        <Typography
          variant="caption"
          weight="bold"
          className="tracking-[0.2em] flex items-center gap-2"
        >
          <ShieldCheck size={14} className="text-yellow-500" /> {t('RESILIENCE_LOG_TITLE')}
        </Typography>

        <div className="space-y-3">
          {logs.length > 0 ? (
            logs.map((log: ResilienceLog, idx: number) => (
              <div
                key={idx}
                className="glass-card p-4 border-white/5 hover:bg-white/[0.02] transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]"></div>
                    <Typography variant="body" weight="bold" className="tracking-tighter">
                      {t('RESILIENCE_EMERGENCY_TRIGGERED')}
                    </Typography>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-white/90">
                    <Clock size={10} />{' '}
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                  </div>
                </div>
                <p className="text-xs text-white/100 font-mono leading-relaxed pl-5 italic">
                  {log.content || 'System autonomous recovery sequence initiated.'}
                </p>
              </div>
            ))
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-white/50 border border-dashed border-white/10 rounded-lg bg-white/[0.01]">
              <ShieldCheck size={32} className="mb-3 opacity-20" />
              <p className="text-xs font-mono uppercase tracking-widest">
                {t('RESILIENCE_NO_EVENTS')}
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
