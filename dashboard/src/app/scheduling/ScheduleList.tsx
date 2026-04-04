'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Plus,
  Zap,
  Target,
  Activity,
  Loader2,
  ShieldCheck,
  Brain,
  Users,
  ChevronRight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { THEME } from '@/lib/theme';

interface Schedule {
  Name: string;
  State: string;
  Description?: string;
  CreationDate?: string;
  ScheduleExpression: string;
  Target?: {
    Input?: string;
  };
}

type ScheduleCategory = 'system-infra' | 'agent-goal' | 'user-created';

interface ScheduleInfo {
  purpose: string;
  category: ScheduleCategory;
}

const getScheduleInfo = (schedule: Schedule): ScheduleInfo => {
  const name = schedule.Name;
  const input = schedule.Target?.Input;

  let payload: Record<string, unknown> = {};
  try {
    payload = input ? JSON.parse(input) : {};
  } catch {
    // ignore parse errors
  }

  // MCP Warmup schedules — derive purpose from target servers list
  if (name.startsWith('MCPWarmup')) {
    const servers = Array.isArray(payload.servers) ? (payload.servers as string[]) : [];
    const serverList = servers.length > 0 ? servers.join(', ') : 'MCP servers';
    const priority = name.includes('Critical')
      ? 'critical'
      : name.includes('LowPriority')
        ? 'low priority'
        : 'standard';
    return {
      purpose: `Keeps ${serverList} warm to prevent cold starts (${priority})`,
      category: 'system-infra',
    };
  }

  // Concurrency monitor
  if (name.startsWith('ConcurrencySchedule') || name.startsWith('Concurrency')) {
    return {
      purpose: 'Monitors Lambda concurrent execution usage — alerts at 80% utilization',
      category: 'system-infra',
    };
  }

  // Recovery / Dead Man's Switch
  if (name.startsWith('RecoverySchedule') || name.startsWith('Recovery')) {
    return {
      purpose: "Dead man's switch — deep health checks and emergency rollback",
      category: 'system-infra',
    };
  }

  // Strategic review
  if (name.startsWith('StrategicReviewSchedule') || name.includes('STRATEGIC_REVIEW')) {
    return {
      purpose: 'Strategic planner autonomous review and evolution cycle',
      category: 'agent-goal',
    };
  }

  // Agent-created goals
  if (payload.agentId && payload.agentId !== 'SYSTEM') {
    return {
      purpose: schedule.Description || `Proactive goal for ${payload.agentId}`,
      category: 'agent-goal',
    };
  }

  // Fallback
  return {
    purpose: schedule.Description || 'User or agent-created schedule',
    category: 'user-created',
  };
};

const CATEGORY_BADGE: Record<ScheduleCategory, { label: string; className: string }> = {
  'system-infra': {
    label: 'SYSTEM INFRA',
    className: 'bg-white/5 text-white/50 border-white/10',
  },
  'agent-goal': {
    label: 'AGENT GOAL',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  'user-created': {
    label: 'USER',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
};

const formatFrequency = (expression?: string) => {
  if (!expression) return 'Unknown';
  if (expression.startsWith('rate(')) {
    const match = expression.match(/rate\((\d+)\s+(\w+)\)/);
    if (match) {
      const [, value, unit] = match;
      const unitShort = unit.endsWith('s') ? unit.slice(0, -1) : unit;

      return `Every ${value} ${unitShort}${parseInt(value) > 1 ? 's' : ''}`;
    }
  }
  if (expression.startsWith('cron(')) {
    return 'Recurring (Cron)';
  }
  if (expression.startsWith('at(')) {
    return 'One-time (At)';
  }
  return expression;
};

const getNextRun = (schedule: Schedule) => {
  if (schedule.State !== 'ENABLED') return 'Paused';
  if (!schedule.CreationDate || !schedule.ScheduleExpression) return 'Unknown';

  const expression = schedule.ScheduleExpression;
  const created = schedule.CreationDate ? new Date(schedule.CreationDate).getTime() : 0;
  const now = Date.now();

  if (expression.startsWith('rate(')) {
    const match = expression.match(/rate\((\d+)\s+(\w+)\)/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];

      let msPerUnit = 60 * 1000; // default minutes
      if (unit.startsWith('hour')) msPerUnit = 60 * 60 * 1000;
      if (unit.startsWith('day')) msPerUnit = 24 * 60 * 60 * 1000;

      const interval = value * msPerUnit;
      const elapsed = now - created;
      const nextRunTime = created + (Math.floor(elapsed / interval) + 1) * interval;

      return new Date(nextRunTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  if (expression.startsWith('at(')) {
    const match = expression.match(/at\((.+)\)/);
    if (match) {
      const atDate = new Date(match[1]);
      if (atDate.getTime() < now) return 'Executed';
      return atDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  return 'Calculated on trigger';
};

export default function ScheduleList() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [showNewGoalModal, setShowNewGoalModal] = useState(false);

  const fetchSchedules = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(false);

    try {
      const response = await fetch('/api/scheduling');
      if (!response.ok) throw new Error('Failed to fetch schedules');
      const data = await response.json();
      setSchedules(
        data.sort((a: Schedule, b: Schedule) => {
          const timeA = a.CreationDate ? new Date(a.CreationDate).getTime() : 0;
          const timeB = b.CreationDate ? new Date(b.CreationDate).getTime() : 0;
          return timeB - timeA;
        })
      );
    } catch (error) {
      console.error(error);
      setFetchError(true);
      toast.error('Failed to load schedules');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  const filteredSchedules = schedules.filter(
    (s) =>
      !s.Name.startsWith('TRIGGER-') &&
      !s.Name.startsWith('RecoverySchedule') &&
      !s.Name.startsWith('StrategicReviewSchedule')
  );

  const plannerSchedule = schedules.find((s) => s?.Name?.includes('PLANNER'));
  const nextEvolution = plannerSchedule ? getNextRun(plannerSchedule) : 'None Scheduled';

  const handleTrigger = async (name: string) => {
    setActionInProgress(name + '-trigger');
    try {
      const response = await fetch('/api/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action: 'trigger' }),
      });
      if (!response.ok) throw new Error('Failed to trigger schedule');
      toast.success(`One-time trigger scheduled for ${name}`);
    } catch {
      toast.error('Failed to trigger execution');
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
      if (!response.ok) throw new Error('Failed to update schedule');
      toast.success(`${name} ${newState === 'ENABLED' ? 'resumed' : 'paused'}`);
      fetchSchedules(true);
    } catch {
      toast.error('Failed to update state');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (name: string) => {
    // eslint-disable-next-line no-alert -- lightweight explicit confirmation before destructive delete.
    if (!window.confirm(`Are you sure you want to delete goal "${name}"?`)) return;

    setActionInProgress(name + '-delete');
    try {
      const response = await fetch(`/api/scheduling?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete schedule');
      toast.success(`Goal ${name} deleted`);
      fetchSchedules(true);
    } catch {
      toast.error('Failed to delete goal');
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <Typography variant="caption" color="muted">
          INITIALIZING_SCHEDULER_REGISTRY...
        </Typography>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Goal Scheduling
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Co-manage proactive agent goals and system-wide heartbeats.
          </Typography>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 hover:bg-white/5"
            onClick={() => fetchSchedules(true)}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <RefreshCw size={14} className="mr-2" />
            )}
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="bg-blue-600 hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.2)]"
            onClick={() => setShowNewGoalModal(true)}
          >
            <Plus size={14} className="mr-2" /> New Goal
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card variant="glass" padding="md" className="border-white/5">
          <div className="flex justify-between items-start mb-2">
            <Typography variant="caption" className="text-white/60 uppercase tracking-widest">
              Active Goals
            </Typography>
            <Target size={16} className="text-blue-500" />
          </div>
          <Typography variant="h3" weight="bold">
            {filteredSchedules.length}
          </Typography>
        </Card>

        <Card variant="glass" padding="md" className="border-white/5">
          <div className="flex justify-between items-start mb-2">
            <Typography variant="caption" className="text-white/60 uppercase tracking-widest">
              Next Evolution
            </Typography>
            <Zap size={16} className="text-yellow-500" />
          </div>
          <Typography variant="h3" weight="bold">
            {nextEvolution}
          </Typography>
        </Card>

        <Card variant="glass" padding="md" className="border-white/5">
          <div className="flex justify-between items-start mb-2">
            <Typography variant="caption" className="text-white/60 uppercase tracking-widest">
              Scheduler Health
            </Typography>
            <Activity size={16} className={fetchError ? 'text-red-500' : 'text-green-500'} />
          </div>
          <Badge
            variant="outline"
            className={
              fetchError
                ? 'bg-red-500/10 text-red-500 border-red-500/20'
                : 'bg-green-500/10 text-green-500 border-green-500/20'
            }
          >
            {fetchError ? 'DISCONNECTED' : 'OPERATIONAL'}
          </Badge>
        </Card>
      </div>

      <div className="space-y-4">
        <Typography variant="h3" weight="bold" className="flex items-center gap-2">
          <Calendar size={18} className="text-blue-500" /> Active Schedule Registry
        </Typography>

        <div className="overflow-hidden border border-white/5 rounded-xl bg-black/20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">
                  Goal ID / Name
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">
                  Expression
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">
                  Agent
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">
                  State
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredSchedules.length > 0 ? (
                filteredSchedules.map((s) => {
                  const payload = s.Target?.Input ? JSON.parse(s.Target.Input) : {};
                  const info = getScheduleInfo(s);
                  const catBadge = CATEGORY_BADGE[info.category];

                  return (
                    <tr key={s.Name} className="hover:bg-white/[0.01] group transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight">
                              {s.Name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 border rounded text-[8px] font-black tracking-tight ${catBadge.className}`}
                            >
                              {catBadge.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-white/50 line-clamp-1">
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
                          <div className="flex items-center gap-2 text-[10px] font-mono text-white/40">
                            <Clock size={10} /> Next: {getNextRun(s)}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold border-white/10 text-white/70"
                        >
                          {payload.agentId ?? 'SYSTEM'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${s.State === 'ENABLED' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-white/20'}`}
                          ></div>
                          <span
                            className={`text-[10px] font-bold ${s.State === 'ENABLED' ? 'text-green-500' : 'text-white/40'}`}
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
                  <td colSpan={5} className="px-6 py-12 text-center text-white/40 italic text-xs">
                    No active schedules found. Agents will create goals automatically as needed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="mt-16 relative">
        <div className="absolute -top-px left-10 right-10 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
            <ShieldCheck size={20} className="text-blue-500" />
          </div>
          <div>
            <Typography variant="h3" weight="bold" className="tracking-tight">
              Co-management Protocol (HITL)
            </Typography>
            <Typography
              variant="mono"
              className="text-[10px] text-blue-500/60 uppercase tracking-[0.2em]"
            >
              Human-In-The-Loop Governance
            </Typography>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card
            variant="glass"
            padding="lg"
            className="border-white/5 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Brain size={80} className="text-blue-500" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <Badge
                  variant="outline"
                  className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[9px] font-black uppercase tracking-widest"
                >
                  Autonomous Role
                </Badge>
              </div>
              <Typography variant="body" weight="bold" className="mb-3 text-white/90 block">
                Strategic Planner Agent
              </Typography>
              <Typography variant="body" className="text-xs text-white/60 leading-relaxed block">
                The core intelligence autonomously creates, adjusts, and retires schedules based on
                identified <span className="text-blue-400 font-mono">evolution_gaps</span> and
                system health telemetry. It operates on a 24h recursive audit cycle to ensure
                proactive system growth.
              </Typography>
              <div className="mt-6 flex items-center gap-4 border-t border-white/5 pt-4">
                <div className="flex flex-col">
                  <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">
                    Sync Priority
                  </span>
                  <span className="text-xs font-mono text-blue-400">P0_CRITICAL</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">
                    Audit Mode
                  </span>
                  <span className="text-xs font-mono text-blue-400">CONTINUOUS</span>
                </div>
              </div>
            </div>
          </Card>

          <Card
            variant="glass"
            padding="lg"
            className="border-white/5 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Users size={80} className="text-amber-500" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] font-black uppercase tracking-widest"
                >
                  Human Co-Manager
                </Badge>
              </div>
              <Typography variant="body" weight="bold" className="mb-3 text-white/90 block">
                Intervention Privileges
              </Typography>
              <ul className="space-y-2">
                {[
                  'Bypass time windows with "Trigger Now" execution',
                  'Pause background autonomy during critical updates',
                  'Override agent-defined frequencies for stability',
                  'Manual "Purge All" for emergency state reset',
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-white/60">
                    <ChevronRight size={12} className="mt-0.5 text-amber-500/50" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </section>

      {/* New Goal Modal */}
      {showNewGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowNewGoalModal(false)}
          />
          <Card
            variant="glass"
            className="w-full max-w-md border-blue-500/20 shadow-[0_0_30px_rgba(37,99,235,0.1)] relative z-10 overflow-hidden"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <Typography variant="h3" weight="bold">
                NEW_PROACTIVE_GOAL
              </Typography>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewGoalModal(false)}
                className="h-8 w-8 !p-0"
              >
                <X size={18} />
              </Button>
            </div>

            <form
              className="p-6 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const name = formData.get('name') as string;
                const task = formData.get('task') as string;
                const agentId = formData.get('agentId') as string;
                const freqValue = formData.get('frequency') as string;
                const freqUnit = formData.get('unit') as string;

                if (!name || !task || !agentId || !freqValue) {
                  toast.error('All fields are required');
                  return;
                }

                setActionInProgress('creating');
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

                  if (!response.ok) throw new Error('Failed to create goal');
                  toast.success(`Goal ${name} established`);
                  setShowNewGoalModal(false);
                  fetchSchedules(true);
                } catch {
                  toast.error('Failed to establish goal');
                } finally {
                  setActionInProgress(null);
                }
              }}
            >
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
                  Goal Identifier (Unique)
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
                  Task Specification
                </label>
                <textarea
                  name="task"
                  placeholder="What should the agent perform?"
                  required
                  rows={3}
                  className="w-full bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-4 text-xs text-white outline-none transition-all resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
                    Target Agent
                  </label>
                  <select
                    name="agentId"
                    className="w-full bg-white/[0.03] border border-white/10 focus:border-blue-500/40 rounded-lg py-2.5 px-3 text-xs text-white outline-none transition-all appearance-none"
                  >
                    <option value="strategic-planner" className="bg-slate-900">
                      PLANNER
                    </option>
                    <option value="coder" className="bg-slate-900">
                      CODER
                    </option>
                    <option value="cognition-reflector" className="bg-slate-900">
                      REFLECTOR
                    </option>
                    <option value="qa" className="bg-slate-900">
                      QA_ENGINEER
                    </option>
                    <option value="worker" className="bg-slate-900">
                      GENERIC_WORKER
                    </option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40 ml-1">
                    Frequency
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
                      <option value="hours" className="bg-slate-900">
                        HOURS
                      </option>
                      <option value="minutes" className="bg-slate-900">
                        MINUTES
                      </option>
                      <option value="days" className="bg-slate-900">
                        DAYS
                      </option>
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
                  disabled={actionInProgress === 'creating'}
                >
                  {actionInProgress === 'creating' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    'ESTABLISH_GOAL'
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
