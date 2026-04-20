'use client';

import React from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { logger } from '@claw/core/lib/logger';

interface NewGoalModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const NewGoalModal: React.FC<NewGoalModalProps> = ({ onClose, onSuccess }) => {
  const { t } = useTranslations();
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const task = formData.get('task') as string;
    const agentId = formData.get('agentId') as string;
    const freqValue = formData.get('frequency') as string;
    const freqUnit = formData.get('unit') as string;

    if (!name || !task || !agentId || !freqValue) {
      toast.error(t('SCHEDULING_FIELDS_REQUIRED'));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name,
          expression: `rate(${freqValue} ${freqUnit})`,
          description: task,
          payload: { goalId: name, task, agentId, userId: 'SYSTEM' },
        }),
      });

      if (!response.ok) throw new Error(t('SCHEDULING_ESTABLISH_ERROR'));
      toast.success(t('SCHEDULING_ESTABLISH_SUCCESS').replace('{name}', name));
      onSuccess();
      onClose();
    } catch (err) {
      logger.error(err);
      toast.error(t('SCHEDULING_ESTABLISH_ERROR'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <Card
        variant="glass"
        className="w-full max-w-md border-blue-500/20 shadow-[0_0_30px_rgba(37,99,235,0.1)] relative z-10 overflow-hidden"
      >
        <div className="p-6 border-b border-white/5 flex justify-between items-center">
          <Typography variant="h3" weight="bold">
            {t('SCHEDULING_NEW_GOAL_TITLE')}
          </Typography>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 !p-0">
            <X size={18} />
          </Button>
        </div>

        <form className="p-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
              {t('SCHEDULING_GOAL_IDENTIFIER')}
            </label>
            <input
              name="name"
              placeholder="e.g., SECURITY_AUDIT_S3"
              required
              className="w-full bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-4 text-xs text-white outline-none transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
              {t('SCHEDULING_TASK_SPECIFICATION')}
            </label>
            <textarea
              name="task"
              placeholder={t('SCHEDULING_NEW_GOAL_PLACEHOLDER')}
              required
              rows={3}
              className="w-full bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-4 text-xs text-white outline-none transition-all resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
                {t('SCHEDULING_TARGET_AGENT')}
              </label>
              <select
                name="agentId"
                className="w-full bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-3 text-xs text-white outline-none transition-all appearance-none"
              >
                <option value="strategic-planner" className="bg-slate-900">PLANNER</option>
                <option value="coder" className="bg-slate-900">CODER</option>
                <option value="cognition-reflector" className="bg-slate-900">REFLECTOR</option>
                <option value="qa" className="bg-slate-900">QA_ENGINEER</option>
                <option value="worker" className="bg-slate-900">GENERIC_WORKER</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
                {t('SCHEDULING_FREQUENCY')}
              </label>
              <div className="flex gap-2">
                <input
                  name="frequency"
                  type="number"
                  defaultValue="24"
                  className="w-16 bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-2 text-xs text-white outline-none transition-all"
                />
                <select
                  name="unit"
                  className="flex-1 bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-2 text-xs text-white outline-none transition-all appearance-none"
                >
                  <option value="hours" className="bg-slate-900">HOURS</option>
                  <option value="minutes" className="bg-slate-900">MINUTES</option>
                  <option value="days" className="bg-slate-900">DAYS</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <Button
              type="submit"
              fullWidth
              variant="primary"
              className="bg-blue-600 hover:bg-blue-500"
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                t('SCHEDULING_ESTABLISH_GOAL')
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
