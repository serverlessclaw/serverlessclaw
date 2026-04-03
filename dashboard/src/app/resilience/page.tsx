import { Resource } from 'sst';
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
import { DynamoMemory } from '@claw/core/lib/memory';
import ResilienceGauge from './ResilienceGauge';



async function getHealth() {
  const typedResource = Resource as { WebhookApi?: { url: string } };
  const apiUrl = typedResource.WebhookApi?.url || process.env.API_URL;

  
  if (!apiUrl) {
    console.error('API URL is missing from Resources and Environment');
    return { status: 'error', message: 'API Configuration Missing' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(`${apiUrl}/health`, { 
      cache: 'no-store',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Health check failed. Status:', response.status, 'Body:', errorText);
      return { 
        status: 'error', 
        message: `Health check failed: ${response.status}`,
        details: errorText,
        url: apiUrl
      };
    }
    return await response.json();
  } catch (e: unknown) {
    const error = e as Error;
    console.error('Error fetching health status:', error);
    const isTimeout = error.name === 'AbortError';

    return { 
      status: 'error', 
      message: isTimeout ? 'System request timed out (5s).' : 'System unreachable or unresponsive.',
      details: error.message,
      url: apiUrl
    };
  }
}

async function getRecoveryLogs() {
  try {
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('DISTILLED#RECOVERY');
    return (items ?? []).sort((a: { timestamp?: number }, b: { timestamp?: number }) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

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
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Resilience Hub
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Autonomous self-healing and system recovery monitor.
          </Typography>
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

      {/* Resilience Gauges */}
      <div className="grid grid-cols-3 gap-8 max-w-2xl mx-auto">
        <div className="flex justify-center">
          <div className="relative">
            <ResilienceGauge
              value={isHealthy ? 95 : 40}
              label="System Health"
              subtitle="API + DB + Bus"
            />
          </div>
        </div>
        <div className="flex justify-center">
          <div className="relative">
            <ResilienceGauge
              value={Math.max(0, 100 - logs.length * 10)}
              label="Error Rate"
              subtitle="Last 24h failures"
            />
          </div>
        </div>
        <div className="flex justify-center">
          <div className="relative">
            <ResilienceGauge
              value={isHealthy ? 100 : 60}
              label="Recovery"
              subtitle="Dead Man's Switch"
            />
          </div>
        </div>
      </div>

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
              <div className="mt-8 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs leading-relaxed italic space-y-2">
                <div className="font-bold">
                  CAUTION: {health.message || 'System health check falling below threshold. Investigate logs.'}
                </div>
                {health.details && (
                  <div className="opacity-80">
                    <span className="font-mono uppercase text-[10px] mr-2">Error:</span>
                    {health.details}
                  </div>
                )}
                {health.url && (
                  <div className="opacity-80 break-all">
                    <span className="font-mono uppercase text-[10px] mr-2">Target:</span>
                    {health.url}/health
                  </div>
                )}
                <div className="pt-2 text-[10px] opacity-60 not-italic">
                  If this is a local development environment, ensure the WebhookApi is reachable or check your networking.
                </div>
              </div>
            )}
          </Card>

          <Card variant="glass" padding="lg" className="border-white/10 bg-black/40 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl -mr-16 -mt-16"></div>
            <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2 mb-6">
              <Timer size={14} className="text-yellow-500" /> Dead Man&apos;s Switch
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                logs.map((log: { timestamp?: number; key?: string; value?: string; content?: string }, idx: number) => (

                  <div key={idx} className="glass-card p-4 border-white/5 hover:bg-white/[0.02] transition-all group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]"></div>
                        <Typography variant="body" weight="bold" className="tracking-tighter">Emergency Recovery Triggered</Typography>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-white/90">
                        <Clock size={10} /> {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
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
