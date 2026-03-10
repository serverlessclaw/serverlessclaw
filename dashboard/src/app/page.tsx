import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Activity, ShieldCheck, Cpu, Terminal, Clock, ChevronRight, MessageSquare } from 'lucide-react';
import Link from 'next/link';

async function getTraces() {
  try {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: Resource.TraceTable.name,
        Limit: 10,
      })
    );
    
    return (Items || []).sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    console.error('Error fetching traces:', e);
    return [];
  }
}

async function getConfig() {
  try {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const [providerRes, modelRes] = await Promise.all([
      docClient.send(new GetCommand({ TableName: (Resource as any).ConfigTable.name, Key: { key: 'active_provider' } })),
      docClient.send(new GetCommand({ TableName: (Resource as any).ConfigTable.name, Key: { key: 'active_model' } }))
    ]);

    return {
      provider: providerRes.Item?.value || 'openai',
      model: modelRes.Item?.value || 'gpt-5.4'
    };
  } catch (e) {
    return { provider: 'unknown', model: 'unknown' };
  }
}

export default async function Dashboard() {
  const [traces, config] = await Promise.all([getTraces(), getConfig()]);

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
        <header className="flex justify-between items-end border-b border-white/5 pb-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight glow-text">TRACE_INTELLIGENCE</h2>
            <p className="text-white/40 text-sm mt-2 font-light">Real-time observer of autonomous agent neural paths.</p>
          </div>
          <div className="flex gap-4">
            <div className="glass-card px-4 py-2 text-[12px]">
              <div className="text-white/30 mb-1">ACTIVE_PROVIDER</div>
              <div className="font-bold text-cyber-blue uppercase">{config.provider}</div>
            </div>
            <div className="glass-card px-4 py-2 text-[12px]">
              <div className="text-white/30 mb-1">ACTIVE_MODEL</div>
              <div className="font-bold truncate max-w-[120px]">{config.model}</div>
            </div>
            <div className="glass-card px-4 py-2 text-[12px] border-cyber-green/30">
              <div className="text-white/30 mb-1 text-cyber-green/60 text-[10px]">TOTAL_OPS</div>
              <div className="font-bold">{traces.length}</div>
            </div>
          </div>
        </header>

        {/* Traces Grid */}
        <section className="space-y-4">
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 flex items-center gap-2">
            <Terminal size={14} className="text-cyber-green" /> Recent Neural Paths
          </h3>
          
          <div className="grid gap-3">
            {traces.length > 0 ? (
              traces.map((trace: any) => (
                <Link 
                  key={trace.traceId} 
                  href={`/trace/${trace.traceId}?t=${trace.timestamp}`}
                  className="glass-card p-4 hover:bg-white/[0.05] transition-all cursor-pointer group cyber-border block"
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className="text-cyber-green/80 text-xs font-bold">[{trace.status.toUpperCase()}]</div>
                      <div className="text-sm font-medium text-white/90">{trace.initialContext?.userText || 'System Task'}</div>
                    </div>
                    <div className="flex items-center gap-6 text-[12px] text-white/30">
                      <div className="flex items-center gap-2">
                        <Clock size={12} /> {new Date(trace.timestamp).toLocaleTimeString()}
                      </div>
                      <div className="group-hover:text-cyber-green transition-colors">
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {trace.steps?.slice(0, 5).map((step: any, i: number) => (
                      <span key={i} className={`text-[9px] px-2 py-0.5 rounded-full border ${
                        step.type === 'tool_call' ? 'border-cyber-blue/30 text-cyber-blue' : 
                        step.type === 'error' ? 'border-red-500/30 text-red-400' : 'border-white/10 text-white/40'
                      }`}>
                        {step.type.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </Link>
              ))
            ) : (
              <div className="h-32 flex flex-col items-center justify-center text-white/20 border border-dashed border-white/10 rounded-lg">
                <Terminal size={24} className="mb-2 opacity-20" />
                <p className="text-xs">NO_TRACES_FOUND // SYSTEM_IDLE</p>
              </div>
            )}
          </div>
        </section>
      </main>
  );
}
