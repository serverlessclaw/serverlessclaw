'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Clock,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Plus,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { THEME } from '@/lib/theme';

import {
  Schedule,
  getScheduleInfo,
  CATEGORY_BADGE,
  formatFrequency,
  getNextRun,
} from '@/lib/scheduling-utils';
import { NewGoalModal } from './NewGoalModal';
import { GovernanceProtocol } from './GovernanceProtocol';
import CyberConfirm from '@/components/CyberConfirm';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import PageHeader from '@/components/PageHeader';
import { logger } from '@claw/core/lib/logger';

export default function ScheduleList() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [showNewGoalModal, setShowNewGoalModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { t } = useTranslations();

  const fetchSchedules = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setFetchError(false);

      try {
        const response = await fetch('/api/scheduling');
        if (!response.ok) throw new Error(t('SCHEDULING_LOAD_ERROR'));
        const data = await response.json();
        setSchedules(
          data.sort((a: Schedule, b: Schedule) => {
            const timeA = a.CreationDate ? new Date(a.CreationDate).getTime() : 0;
            const timeB = b.CreationDate ? new Date(b.CreationDate).getTime() : 0;
            return timeB - timeA;
          })
        );
      } catch (error) {
        logger.error(error);
        setFetchError(true);
        toast.error(t('SCHEDULING_LOAD_ERROR'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const filteredSchedules = schedules.filter(
    (s) =>
      !s.Name.startsWith('TRIGGER-') &&
      !s.Name.startsWith('RecoverySchedule') &&
      !s.Name.startsWith('StrategicReviewSchedule')
  );

  const handleTrigger = async (name: string) => {
    setActionInProgress(name + '-trigger');
    try {
      const response = await fetch('/api/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action: 'trigger' }),
      });
      if (!response.ok) throw new Error(t('SCHEDULING_TRIGGER_ERROR'));
      toast.success(t('SCHEDULING_TRIGGER_SUCCESS').replace('{name}', name));
    } catch {
      toast.error(t('SCHEDULING_TRIGGER_ERROR'));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleToggleState = async (name: string, currentState: string) => {
    const newState = currentState === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    setActionInProgress(name + '-toggle');
    try {
      const response = await fetch('/api/scheduling', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, state: newState }),
      });
      if (!response.ok) throw new Error(t('SCHEDULING_STATE_ERROR'));
      toast.success(
        `${name} ${newState === 'ENABLED' ? t('SCHEDULING_STATE_RESUMED') : t('SCHEDULING_STATE_PAUSED')}`
      );
      fetchSchedules(true);
    } catch {
      toast.error(t('SCHEDULING_STATE_ERROR'));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (name: string) => {
    setDeleteTarget(name);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget;
    setDeleteTarget(null);

    setActionInProgress(name + '-delete');
    try {
      const response = await fetch(`/api/scheduling?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(t('SCHEDULING_DELETE_SUCCESS').replace('{name}', name));
      toast.success(t('SCHEDULING_DELETE_SUCCESS').replace('{name}', name));
      fetchSchedules(true);
    } catch {
      toast.error(t('SCHEDULING_STATE_ERROR'));
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <Typography variant="caption" color="muted">
          {t('SCHEDULING_INITIALIZING')}
        </Typography>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PageHeader
        titleKey="SCHEDULING_TITLE"
        subtitleKey="SCHEDULING_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                GOALS
              </Typography>
              <Badge variant="primary" className="px-4 py-1 font-black text-xs">
                {filteredSchedules.length}
              </Badge>
            </div>
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                HEALTH
              </Typography>
              <Badge
                variant="outline"
                className={`px-4 py-1 font-bold text-xs border-none ${
                  fetchError ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
                }`}
              >
                {fetchError ? 'OFFLINE' : 'ONLINE'}
              </Badge>
            </div>
          </div>
        }
      >
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSchedules(true)}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <RefreshCw size={14} className="mr-2" />
            )}
            {t('COMMON_REFRESH')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="bg-blue-600 hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.2)]"
            onClick={() => setShowNewGoalModal(true)}
          >
            <Plus size={14} className="mr-2" /> {t('SCHEDULING_NEW_GOAL')}
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-4">
        <Typography variant="h3" weight="bold" className="flex items-center gap-2">
          <Calendar size={18} className="text-blue-500" /> {t('SCHEDULING_REGISTRY_TITLE')}
        </Typography>

        <div className="overflow-hidden border border-border rounded-xl bg-card/40">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-card-elevated/50">
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                  {t('SCHEDULING_GOAL_ID_NAME')}
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                  {t('SCHEDULING_EXPRESSION')}
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                  {t('SCHEDULING_AGENT')}
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                  {t('SCHEDULING_STATE')}
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 text-right">
                  {t('SCHEDULING_ACTIONS')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSchedules.length > 0 ? (
                filteredSchedules.map((s) => {
                  const payload = s.Target?.Input ? JSON.parse(s.Target.Input) : {};
                  const info = getScheduleInfo(s);
                  const catBadge = CATEGORY_BADGE[info.category];

                  return (
                    <tr key={s.Name} className="hover:bg-card/50 group transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground group-hover:text-blue-400 transition-colors uppercase tracking-tight">
                              {s.Name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 border rounded text-[8px] font-black tracking-tight ${catBadge.className}`}
                            >
                              {catBadge.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 line-clamp-1">
                            {info.purpose}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div
                            className={`text-[10px] font-mono text-${THEME.COLORS.PRIMARY} font-bold flex items-center gap-1`}
                          >
                            <RefreshCw size={10} /> {formatFrequency(s.ScheduleExpression)}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-more">
                            <Clock size={10} />{' '}
                            {t('SCHEDULING_NEXT_RUN').replace('{time}', getNextRun(s))}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold border-border text-muted-foreground"
                        >
                          {payload.agentId ?? 'SYSTEM'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${s.State === 'ENABLED' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-muted-more'}`}
                          ></div>
                          <span
                            className={`text-[10px] font-bold ${s.State === 'ENABLED' ? 'text-green-500' : 'text-muted-more'}`}
                          >
                            {s.State}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 !p-0 text-blue-400 hover:bg-blue-400/10"
                            title="Trigger Now"
                            onClick={() => handleTrigger(s.Name)}
                            disabled={!!actionInProgress}
                          >
                            {actionInProgress === s.Name + '-trigger' ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Play size={14} />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 w-8 !p-0 ${s.State === 'ENABLED' ? 'text-yellow-400 hover:bg-yellow-400/10' : 'text-green-400 hover:bg-green-400/10'}`}
                            title={s.State === 'ENABLED' ? 'Pause' : 'Resume'}
                            onClick={() => handleToggleState(s.Name, s.State)}
                            disabled={!!actionInProgress}
                          >
                            {actionInProgress === s.Name + '-toggle' ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : s.State === 'ENABLED' ? (
                              <Pause size={14} />
                            ) : (
                              <Play size={14} />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 !p-0 text-red-500 hover:bg-red-500/10"
                            title="Delete"
                            onClick={() => handleDelete(s.Name)}
                            disabled={!!actionInProgress}
                          >
                            {actionInProgress === s.Name + '-delete' ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-more italic text-xs">
                    {t('SCHEDULING_NO_SCHEDULES')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <GovernanceProtocol />

      {showNewGoalModal && (
        <NewGoalModal
          onClose={() => setShowNewGoalModal(false)}
          onSuccess={() => fetchSchedules(true)}
        />
      )}
      <CyberConfirm
        isOpen={!!deleteTarget}
        title={t('SCHEDULING_TERMINATE_TITLE')}
        message={t('SCHEDULING_TERMINATE_MESSAGE').replace('{name}', deleteTarget || '')}
        variant="danger"
        confirmText={t('SCHEDULING_CONFIRM_TERMINATION')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
