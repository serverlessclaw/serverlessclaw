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
  AlertCircle,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { THEME } from '@/lib/theme';

interface Schedule {
  Name: string;
  ScheduleExpression: string;
  State: string;
  Description?: string;
  CreationDate?: string;
  Target?: {
    Input?: string;
  };
}

export default function ScheduleList() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchSchedules = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    
    try {
      const response = await fetch('/api/scheduling');
      if (!response.ok) throw new Error('Failed to fetch schedules');
      const data = await response.json();
      setSchedules(data.sort((a: any, b: any) => 
        new Date(b.CreationDate).getTime() - new Date(a.CreationDate).getTime()
      ));
    } catch (error) {
      console.error(error);
      toast.error('Failed to load schedules');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

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
    } catch (error) {
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
    } catch (error) {
      toast.error('Failed to update state');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete goal "${name}"?`)) return;
    
    setActionInProgress(name + '-delete');
    try {
      const response = await fetch(`/api/scheduling?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete schedule');
      toast.success(`Goal ${name} deleted`);
      fetchSchedules(true);
    } catch (error) {
      toast.error('Failed to delete goal');
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <Typography variant="caption" color="muted">INITIALIZING_SCHEDULER_REGISTRY...</Typography>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <Typography variant="h2" weight="bold" color="white" glow className="!text-blue-500">Autonomous Scheduling</Typography>
          <Typography variant="body" color="white" className="mt-2 block opacity-80">Co-manage proactive agent goals and system-wide heartbeats.</Typography>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="outline" 
            size="sm" 
            className="border-white/10 hover:bg-white/5"
            onClick={() => fetchSchedules(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />} 
            Refresh
          </Button>
          <Button 
            variant="primary" 
            size="sm" 
            className="bg-blue-600 hover:bg-blue-500"
            onClick={() => toast.info('AI agents create goals automatically. UI for manual creation coming soon.')}
          >
            <Plus size={14} className="mr-2" /> New Goal
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card variant="glass" padding="md" className="border-white/5">
          <div className="flex justify-between items-start mb-2">
            <Typography variant="caption" className="text-white/60 uppercase tracking-widest">Active Goals</Typography>
            <Target size={16} className="text-blue-500" />
          </div>
          <Typography variant="h3" weight="bold">{schedules.length}</Typography>
        </Card>
        
        <Card variant="glass" padding="md" className="border-white/5">
          <div className="flex justify-between items-start mb-2">
            <Typography variant="caption" className="text-white/60 uppercase tracking-widest">Next Evolution</Typography>
            <Zap size={16} className="text-yellow-500" />
          </div>
          <Typography variant="h3" weight="bold">
            {schedules.find(s => s?.Name?.includes('PLANNER')) ? 'In ~24h' : 'None Scheduled'}
          </Typography>
        </Card>

        <Card variant="glass" padding="md" className="border-white/5">
          <div className="flex justify-between items-start mb-2">
            <Typography variant="caption" className="text-white/60 uppercase tracking-widest">Scheduler Health</Typography>
            <ActivityIcon size={16} className="text-green-500" />
          </div>
          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">OPERATIONAL</Badge>
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
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">Goal ID / Name</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">Expression</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">Agent</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50">State</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/50 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {schedules.length > 0 ? schedules.map((s) => {
                const payload = s.Target?.Input ? JSON.parse(s.Target.Input) : {};
                const isSystem = s.Name.startsWith('TRIGGER-');
                if (isSystem) return null; // Hide internal trigger schedules

                return (
                  <tr key={s.Name} className="hover:bg-white/[0.01] group transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight">{s.Name}</span>
                        <span className="text-[10px] text-white/50 line-clamp-1 italic">{s.Description || 'No description provided.'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-[10px] font-mono text-white/100">
                        <Clock size={10} className="text-blue-400" /> {s.ScheduleExpression}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="text-[10px] font-bold border-white/10 text-white/70">
                        {payload.agentId || 'SYSTEM'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${s.State === 'ENABLED' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-white/20'}`}></div>
                        <span className={`text-[10px] font-bold ${s.State === 'ENABLED' ? 'text-green-500' : 'text-white/40'}`}>{s.State}</span>
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
                          {actionInProgress === s.Name + '-trigger' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 w-8 !p-0 ${s.State === 'ENABLED' ? 'text-yellow-400 hover:bg-yellow-400/10' : 'text-green-400 hover:bg-green-400/10'}`} 
                          title={s.State === 'ENABLED' ? 'Pause' : 'Resume'}
                          onClick={() => handleToggleState(s.Name, s.State)}
                          disabled={!!actionInProgress}
                        >
                          {actionInProgress === s.Name + '-toggle' ? <Loader2 size={14} className="animate-spin" /> : (s.State === 'ENABLED' ? <Pause size={14} /> : <Play size={14} />)}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 !p-0 text-red-500 hover:bg-red-500/10" 
                          title="Delete"
                          onClick={() => handleDelete(s.Name)}
                          disabled={!!actionInProgress}
                        >
                          {actionInProgress === s.Name + '-delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
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
      
      <section className="mt-12 p-8 border border-white/5 rounded-2xl bg-gradient-to-br from-blue-500/5 to-transparent">
        <Typography variant="h3" weight="bold" className="mb-4">Co-management Protocol (HITL)</Typography>
        <Typography variant="body" className="text-xs text-white/100 leading-relaxed max-w-2xl opacity-80">
          The <strong>Strategic Planner</strong> autonomously manages these schedules based on evolution gaps and system audits. 
          As a human co-manager, you can intervene to reset frequency, trigger immediate executions (bypassing time windows), 
          or pause background autonomy during high-risk operations.
        </Typography>
      </section>
    </div>
  );
}

const ActivityIcon = ({ size, className }: any) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
