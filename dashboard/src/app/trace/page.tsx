import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Activity, ShieldCheck, Cpu, Terminal, Clock, ChevronRight, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { SSTResource } from '@claw/core/lib/types/index';
import DeleteAllTracesButton from '@/components/DeleteAllTracesButton';
import { TraceSource } from '@claw/core/lib/types/index';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import TraceIntelligenceView from '@/components/TraceIntelligenceView';

export const dynamic = 'force-dynamic';

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
    
    // 1. Fetch generic dashboard-user traces via GSI (Fast & Precise)
    // 2026 update: we scan for everything to ensure interleaved sorting for all user types
    const generalScan = docClient.send(
      new ScanCommand({
        TableName: tableName,
        Limit: 1000,
      })
    );

    const scanRes = await generalScan;
    
    // Merge and deduplicate by traceId
    const merged = [...(scanRes.Items || [])];
    const uniqueMap = new Map();
    merged.forEach(item => uniqueMap.set(item.traceId, item));
    
    const allItems = Array.from(uniqueMap.values()).sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
    
    // Filter out internal reflector/system tasks to keep the view clean for the user
    // but keep dashboard/telegram traces
    return allItems.filter(item => item.source !== TraceSource.SYSTEM);
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
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
        <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
          <div>
            <Typography variant="h2" color="white" glow uppercase>
              Trace Intelligence
            </Typography>
            <Typography variant="body" color="muted" className="mt-2 block">
              Neural observation of autonomous agent logic paths and decision matrices.
            </Typography>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:flex gap-3 lg:gap-4">
            <DeleteAllTracesButton />
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">PROVIDER</Typography>
                <Badge variant="outline" className="px-4 py-1 font-bold text-xs border-cyber-blue/20 text-cyber-blue/60 uppercase">{config.provider}</Badge>
            </div>
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">MODEL</Typography>
                <Badge variant="outline" className="px-4 py-1 font-bold text-xs border-white/10 text-white/60 uppercase">{config.model}</Badge>
            </div>
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">TOTAL_OPS</Typography>
                <Badge variant="primary" className="px-4 py-1 font-black text-xs">{traces.length}</Badge>
            </div>
          </div>
        </header>

        {/* Traces Observatory */}
        <TraceIntelligenceView initialTraces={traces} />
      </main>
  );
}
