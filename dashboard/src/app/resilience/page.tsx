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

async function getHealth() {
  try {
    const response = await fetch(`${Resource.WebhookApi.url}/health`, { cache: 'no-store' });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Health check failed. Status:', response.status, 'Body:', errorText);
      throw new Error(`Health check failed: ${response.status}`);
    }
    return await response.json();
  } catch (e) {
    console.error('Error fetching health status:', e);
    return { status: 'error', message: 'System unreachable or unresponsive.' };
  }
}

async function getRecoveryLogs() {
  try {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: Resource.MemoryTable.name,
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: {
          ':prefix': 'DISTILLED#RECOVERY',
        },
      })
    );
    
    return (Items || []).sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    console.error('Error fetching recovery logs:', e);
    return [];
  }
}

export default async function ResilienceHub() {
  const health = await getHealth();
  const logs = await getRecoveryLogs();

  const isHealthy = health.status === 'ok';

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text-yellow">RESILIENCE_HUB</h2>
          <p className="text-white/40 text-sm mt-2 font-light">Autonomous self-healing and system recovery monitor.</p>
        </div>
        <div className="flex gap-4">
          <div className={`glass-card px-4 py-2 text-[12px] border-2 ${isHealthy ? 'border-cyber-green/30' : 'border-red-500/50 animate-pulse'}`}>
            <div className="text-white/30 mb-1">SYSTEM_STATUS</div>
            <div className={`font-bold flex items-center gap-2 ${isHealthy ? 'text-cyber-green' : 'text-red-500'}`}>
              {isHealthy ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              {health.status.toUpperCase()}
            </div>
          </div>
          <div className="glass-card px-4 py-2 text-[12px]">
            <div className="text-white/30 mb-1">RECOVERY_OPS</div>
            <div className="font-bold text-yellow-500">{logs.length}</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Health & DMS */}
        <div className="lg:col-span-1 space-y-8">
          <section className="glass-card p-6 border-white/10 bg-black/40">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 flex items-center gap-2 mb-6">
              <Activity size={14} className="text-cyber-green" /> Real-time Diagnostics
            </h3>
            
            <div className="space-y-6">
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/60">Core API</span>
                <span className="text-cyber-green font-bold">STABLE</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/60">DynamoDB Layer</span>
                <span className="text-cyber-green font-bold text-xs">
                  {health.deployCountToday !== undefined ? `ACTIVE (${health.deployCountToday} deploys today)` : 'ACTIVE'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/60">Last Probe</span>
                <span className="text-white/30 text-[10px]">{new Date().toLocaleTimeString()}</span>
              </div>
            </div>

            {!isHealthy && (
              <div className="mt-8 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs leading-relaxed italic">
                CAUTION: {health.message || 'System health check falling below threshold. Investigate logs.'}
              </div>
            )}
          </section>

          <section className="glass-card p-6 border-white/10 bg-black/40 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl -mr-16 -mt-16"></div>
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 flex items-center gap-2 mb-6">
              <Timer size={14} className="text-yellow-500" /> Dead Man's Switch
            </h3>
            
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full border border-yellow-500/20 flex items-center justify-center bg-yellow-500/5">
                <Zap size={20} className="text-yellow-500" />
              </div>
              <div>
                <div className="text-xs font-bold text-white/90">Autonomous Pulse</div>
                <div className="text-[10px] text-white/40">Schedules: Every 15 minutes</div>
              </div>
            </div>

            <div className="p-3 bg-white/[0.02] border border-white/5 rounded space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-white/40 uppercase">Mode</span>
                <span className="text-yellow-500/80 font-bold">AUTO_RECOVERY</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-white/40 uppercase">Action</span>
                <span className="text-white/70 italic">TRIGGER_ROLLBACK</span>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Recovery Logs */}
        <div className="lg:col-span-2">
          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 flex items-center gap-2">
              <ShieldCheck size={14} className="text-yellow-500" /> recovery_operations_log
            </h3>
            
            <div className="space-y-3">
              {logs.length > 0 ? (
                logs.map((log: any, idx: number) => (
                  <div key={idx} className="glass-card p-4 border-white/5 hover:bg-white/[0.02] transition-all group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]"></div>
                        <div className="text-sm font-bold text-white/90 uppercase tracking-tighter">Emergency Recovery Triggered</div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-white/30">
                        <Clock size={10} /> {new Date(log.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <p className="text-xs text-white/60 font-mono leading-relaxed pl-5 italic">
                      {log.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-white/20 border border-dashed border-white/10 rounded-lg bg-white/[0.01]">
                   <ShieldCheck size={32} className="mb-3 opacity-20" />
                   <p className="text-xs font-mono uppercase tracking-widest">No recovery events found // system_stable</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
