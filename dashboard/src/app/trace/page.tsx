import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Activity, ShieldCheck, Cpu, Terminal, Clock, ChevronRight, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { SSTResource } from '@claw/core/lib/types/index';

async function getTraces() {
  try {
    const typedResource = Resource as unknown as SSTResource;
    const tableName = typedResource.TraceTable?.name;
    if (!tableName) {
      console.error('TraceTable name is missing from Resources');
      return [];
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        Limit: 10,
      })
    );
    
    return (Items || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch (e) {
    console.error('Error fetching traces:', e);
    return [];
  }
}

async function getConfig() {
  try {
    const typedResource = Resource as unknown as SSTResource;
    const tableName = typedResource.ConfigTable?.name;
    if (!tableName) {
      console.error('ConfigTable name is missing from Resources');
      return { provider: 'unknown', model: 'unknown' };
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const [providerRes, modelRes] = await Promise.all([
      docClient.send(new GetCommand({ TableName: tableName, Key: { key: 'active_provider' } })),
      docClient.send(new GetCommand({ TableName: tableName, Key: { key: 'active_model' } }))
    ]);

    return {
      provider: providerRes.Item?.value || 'openai',
      model: modelRes.Item?.value || 'gpt-5.4'
    };
  } catch (e) {
    console.error('Error fetching config:', e);
    return { provider: 'error', model: 'error' };
  }
}

export default async function Dashboard() {
  const [traces, config] = await Promise.all([getTraces(), getConfig()]);

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-8 lg:space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
        <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
          <div className="max-w-xl">
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight glow-text uppercase">TRACE_INTELLIGENCE</h2>
            <p className="text-white/100 text-xs lg:text-sm mt-2 font-light leading-relaxed">Neural observation of autonomous agent logic paths and decision matrices.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:flex gap-3 lg:gap-4">
            <div className="glass-card px-4 py-2.5 text-[11px] lg:text-[12px]">
              <div className="text-white/90 mb-1 font-bold tracking-widest text-[9px]">PROVIDER</div>
              <div className="font-bold text-cyber-blue uppercase truncate">{config.provider}</div>
            </div>
            <div className="glass-card px-4 py-2.5 text-[11px] lg:text-[12px]">
              <div className="text-white/90 mb-1 font-bold tracking-widest text-[9px]">MODEL</div>
              <div className="font-bold truncate max-w-[100px] lg:max-w-[120px] uppercase">{config.model}</div>
            </div>
            <div className="glass-card px-4 py-2.5 text-[11px] lg:text-[12px] border-cyber-green/30 col-span-2 md:col-span-1">
              <div className="text-white/90 mb-1 text-cyber-green/60 font-bold tracking-widest text-[9px]">TOTAL_OPS</div>
              <div className="font-bold flex items-center gap-2">
                {traces.length}
                <span className="w-1.5 h-1.5 bg-cyber-green rounded-full animate-pulse"></span>
              </div>
            </div>
          </div>
        </header>

        {/* Traces Grid */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2">
              <Terminal size={14} className="text-cyber-green" /> Recent Neural Paths
            </h3>
            <span className="text-[9px] text-white/50 font-mono hidden md:block">LAST_UPDATE: {new Date().toISOString()}</span>
          </div>
          
          <div className="grid gap-3">
            {traces.length > 0 ? (
              traces.map((trace: Record<string, any>) => (
                <Link 
                  key={trace.traceId} 
                  href={`/trace/${trace.traceId}?t=${trace.timestamp}`}
                  className="glass-card p-4 hover:bg-white/[0.05] transition-all cursor-pointer group cyber-border block relative overflow-hidden"
                >
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                    <div className="flex items-start md:items-center gap-3 lg:gap-4">
                      <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        trace.status === 'completed' ? 'text-cyber-green/80 border-cyber-green/20' : 'text-amber-400/80 border-amber-400/20'
                      }`}>
                        {trace.status.toUpperCase()}
                      </div>
                      <div className="text-sm font-medium text-white/90 truncate max-w-[200px] md:max-w-md">{trace.initialContext?.userText || 'System Task'}</div>
                    </div>
                    <div className="flex items-center justify-between md:justify-end gap-6 text-[11px] text-white/90">
                      <div className="flex items-center gap-2 font-mono">
                        <Clock size={12} /> {new Date(trace.timestamp).toLocaleTimeString()}
                      </div>
                      <div className="group-hover:text-cyber-green transition-all transform group-hover:translate-x-1">
                        <ChevronRight size={18} />
                      </div>
                    </div>
                  </div>
                  
                  {/* Steps tags */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {trace.steps?.slice(0, 6).map((step: any, i: number) => (
                      <span key={i} className={`text-[9px] px-2 py-0.5 rounded border font-bold tracking-tight ${
                        step.type === 'tool_call' ? 'border-cyber-blue/20 bg-cyber-blue/5 text-cyber-blue' : 
                        step.type === 'error' ? 'border-red-500/20 bg-red-500/5 text-red-400' : 
                        step.type === 'llm_call' ? 'border-purple-500/20 bg-purple-500/5 text-purple-400' :
                        'border-white/5 bg-white/5 text-white/100'
                      }`}>
                        {step.type.toUpperCase()}
                      </span>
                    ))}
                    {trace.steps?.length > 6 && (
                      <span className="text-[9px] text-white/50 flex items-center">+{trace.steps.length - 6} MORE</span>
                    )}
                  </div>
                </Link>
              ))
            ) : (
              <div className="h-40 flex flex-col items-center justify-center text-white/50 border border-dashed border-white/10 rounded-lg bg-white/[0.02]">
                <Terminal size={32} className="mb-3 opacity-20 animate-pulse" />
                <p className="text-[10px] tracking-[0.2em] font-bold">NO_TRACES_FOUND // SYSTEM_IDLE</p>
              </div>
            )}
          </div>
        </section>
      </main>
  );
}
