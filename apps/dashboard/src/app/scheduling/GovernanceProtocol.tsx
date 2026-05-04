import React from 'react';
import { ShieldCheck, Brain, Users, ChevronRight } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

export const GovernanceProtocol: React.FC = () => {
  const { t } = useTranslations();
  return (
    <section className="mt-16 relative">
      <div className="absolute -top-px left-10 right-10 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
          <ShieldCheck size={20} className="text-blue-500" />
        </div>
        <div>
          <Typography variant="h3" weight="bold" className="tracking-tight">
            {t('SCHEDULING_GOVERNANCE_TITLE')}
          </Typography>
          <Typography
            variant="mono"
            className="text-[10px] text-blue-500/60 uppercase tracking-[0.2em]"
          >
            {t('SCHEDULING_GOVERNANCE_SUBTITLE')}
          </Typography>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card variant="glass" padding="lg" className="border-border relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Brain size={80} className="text-blue-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <Badge
                variant="outline"
                className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[9px] font-black uppercase tracking-widest"
              >
                {t('SCHEDULING_AUTONOMOUS_ROLE')}
              </Badge>
            </div>
            <Typography variant="body" weight="bold" className="mb-3 text-foreground block">
              {t('SCHEDULING_STRATEGIC_PLANNER')}
            </Typography>
            <Typography
              variant="body"
              className="text-xs text-muted-foreground leading-relaxed block"
            >
              {t('SCHEDULING_STRATEGIC_PLANNER_DESC').replace('{gaps}', 'evolution_gaps')}
            </Typography>
            <div className="mt-6 flex items-center gap-4 border-t border-border pt-4">
              <div className="flex flex-col">
                <span className="text-[9px] text-muted-more uppercase font-black tracking-widest">
                  {t('SCHEDULING_SYNC_PRIORITY')}
                </span>
                <span className="text-xs font-mono text-blue-400">P0_CRITICAL</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] text-muted-more uppercase font-black tracking-widest">
                  {t('SCHEDULING_AUDIT_MODE')}
                </span>
                <span className="text-xs font-mono text-blue-400">CONTINUOUS</span>
              </div>
            </div>
          </div>
        </Card>

        <Card variant="glass" padding="lg" className="border-border relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Users size={80} className="text-amber-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] font-black uppercase tracking-widest"
              >
                {t('SCHEDULING_HUMAN_CO_MANAGER')}
              </Badge>
            </div>
            <Typography variant="body" weight="bold" className="mb-3 text-foreground block">
              {t('SCHEDULING_INTERVENTION_PRIVILEGES')}
            </Typography>
            <ul className="space-y-2">
              {[
                t('SCHEDULING_PRIVILEGE_TRIGGER'),
                t('SCHEDULING_PRIVILEGE_PAUSE'),
                t('SCHEDULING_PRIVILEGE_OVERRIDE'),
                t('SCHEDULING_PRIVILEGE_PURGE'),
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ChevronRight size={12} className="mt-0.5 text-amber-500/50" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </section>
  );
};
