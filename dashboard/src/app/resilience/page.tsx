import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { 
  ShieldCheck, 
  Activity, 
  Clock, 
  AlertTriangle, 
  CheckCircle,
  Zap,
  Timer
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { THEME } from '@/lib/theme';
import { DynamoMemory } from '@claw/core/lib/memory';


async function getHealth() {
  try {
    const apiUrl = (Resource as any).WebhookApi?.url;
    if (!apiUrl) {
      console.error('WebhookApi URL is missing from Resources');
      return { status: 'error', message: 'API Configuration Missing' };
    }
    const response = await fetch(`${apiUrl}/health`, { cache: 'no-store' });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Health check failed. Status:', response.status, 'Body:', errorText);
      return { status: 'error', message: `Health check failed: ${response.status}` };
    }
    return await response.json();
  } catch (e) {
    console.error('Error fetching health status:', e);
    return { status: 'error', message: 'System unreachable or unresponsive.' };
  }
}

async function getRecoveryLogs() {
  try {
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('DISTILLED#RECOVERY');
    return (items ?? []).sort((a: any, b: any) => b.timestamp - a.timestamp);
  } catch (e) {
    console.error('Error fetching recovery logs:', e);
    return [];
  }
}


/** ResilienceHub — displays the live health status, recovery logs, and Dead Man's Switch circuit-breaker state for the ClawCenter Observability sector. */
export default async function ResilienceHub() {
  const health = await getHealth();
  const logs = await getRecoveryLogs();

  const isHealthy = health.status === 'ok';

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <Typography variant="h2" weight="bold" color="white" glow className="!text-yellow-500">Resilience Hub</Typography>
          <Typography variant="body" color="white" className="mt-2 block opacity-80">Autonomous self-healing and system recovery monitor.</Typography>
        </div>
        <div className="flex gap-4">
          <Card variant="glass" padding="sm" className={`px-4 py-2 min-w-[120px] border-2 ${isHealthy ? 'border-[var(--cyber-green)]/30' : 'border-red-500/50 animate-pulse'}`}>
            <Typography variant="mono" color="white" className="mb-1 block opacity-90">System Status</Typography>
            <div className={`font-bold flex items-center gap-2 ${isHealthy ? 'text-[var(--cyber-green)]' : 'text-red-500'}`}>
              {isHealthy ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              {health.status}
            </div>
          </Card>
          <Card variant="glass" padding="sm" className="px-4 py-2 min-w-[120px]">
            <Typography variant="mono" color="white" className="mb-1 block opacity-90">Recovery Ops</Typography>
            <Typography variant="h3" weight="bold" className="text-yellow-500">{logs.length}</Typography>
          </Card>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Health & DMS */}
        <div className="lg:col-span-1 space-y-8">
          <Card variant="glass" padding="lg" className="border-white/10 bg-black/40">
            <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2 mb-6">
              <Activity size={14} className="text-[var(--cyber-green)]" /> Real-time Diagnostics
            </Typography>
            
            <div className="space-y-6">
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/100">Core API</span>
                <span className="text-cyber-green font-bold">STABLE</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/100">DynamoDB Layer</span>
                <span className="text-cyber-green font-bold text-xs">
                  {health.deployCountToday !== undefined ? `ACTIVE (${health.deployCountToday} deploys today)` : 'ACTIVE'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/100">Last Probe</span>
                <span className="text-white/90 text-[10px]">{new Date().toLocaleTimeString()}</span>
              </div>
            </div>

            {!isHealthy && (
              <div className="mt-8 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs leading-relaxed italic">
                CAUTION: {health.message || 'System health check falling below threshold. Investigate logs.'}
              </div>
            )}
          </Card>

          <Card variant="glass" padding="lg" className="border-white/10 bg-black/40 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl -mr-16 -mt-16"></div>
            <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2 mb-6">
              <Timer size={14} className="text-yellow-500" /> Dead Man's Switch
            </Typography>
            
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full border border-yellow-500/20 flex items-center justify-center bg-yellow-500/5">
                <Zap size={20} className="text-yellow-500" />
              </div>
              <div>
                <div className="text-xs font-bold text-white/90">Autonomous Pulse</div>
                <div className="text-[10px] text-white/100">Schedules: Every 15 minutes</div>
              </div>
            </div>

            <div className="p-3 bg-white/[0.02] border border-white/5 rounded space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-white/100 uppercase">Mode</span>
                <span className="text-yellow-500/80 font-bold">AUTO_RECOVERY</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-white/100 uppercase">Action</span>
                <span className="text-white/70 italic">TRIGGER_ROLLBACK</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Recovery Logs */}
        <div className="lg:col-span-2">
          <Card variant="solid" padding="lg" className="space-y-4 border-white/5">
            <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2">
              <ShieldCheck size={14} className="text-yellow-500" /> Recovery Operations Log
            </Typography>
            
            <div className="space-y-3">
              {logs.length > 0 ? (
                logs.map((log: any, idx: number) => (
                  <div key={idx} className="glass-card p-4 border-white/5 hover:bg-white/[0.02] transition-all group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]"></div>
                        <Typography variant="body" weight="bold" className="tracking-tighter">Emergency Recovery Triggered</Typography>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-white/90">
                        <Clock size={10} /> {new Date(log.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <p className="text-xs text-white/100 font-mono leading-relaxed pl-5 italic">
                      {log.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-white/50 border border-dashed border-white/10 rounded-lg bg-white/[0.01]">
                   <ShieldCheck size={32} className="mb-3 opacity-20" />
                   <p className="text-xs font-mono uppercase tracking-widest">No recovery events found // system_stable</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
