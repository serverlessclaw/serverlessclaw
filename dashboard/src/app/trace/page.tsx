import { getResourceName } from '@/lib/sst-utils';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import DeleteAllTracesButton from '@/components/DeleteAllTracesButton';
import { TraceSource } from '@claw/core/lib/types/index';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import TraceIntelligenceView from '@/components/TraceIntelligenceView';
import ExportTracesButton from '@/components/ExportTracesButton';

export const dynamic = 'force-dynamic';

function decodePaginationToken(token: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    return undefined;
  }
}

function encodePaginationToken(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

async function getTraces(nextToken?: string) {
  try {
    const tableName = getResourceName('TraceTable');
    if (!tableName) {
      console.warn('TraceTable name is missing from Resources and Environment');
      return { items: [], nextToken: undefined };
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const generalScan = docClient.send(
      new ScanCommand({
        TableName: tableName,
        Limit: 100,
        ExclusiveStartKey: decodePaginationToken(nextToken ?? ''),
      })
    );

    const scanRes = await generalScan;
    
    const merged = [...(scanRes.Items ?? [])];
    const uniqueMap = new Map();
    merged.forEach(item => uniqueMap.set(item.traceId, item));
    
    const allItems = Array.from(uniqueMap.values()).sort((a, b) => {
      const bTs = Number(b.timestamp);
      const aTs = Number(a.timestamp);
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
    
    const filtered = allItems.filter(item => item.source !== TraceSource.SYSTEM);
    const encodedNext = encodePaginationToken(scanRes.LastEvaluatedKey);
    
    return { items: filtered, nextToken: encodedNext };
  } catch (e) {
    console.error('Error fetching traces:', e);
    return { items: [], nextToken: undefined };
  }
}

import { LLMProvider, OpenAIModel } from '@claw/core/lib/types/llm';

async function getConfig() {
  try {
    const tableName = getResourceName('ConfigTable');
    if (!tableName) {
      return { provider: 'N/A', model: 'N/A' };
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const [providerRes, modelRes] = await Promise.all([
      docClient.send(new GetCommand({ TableName: tableName, Key: { key: 'active_provider' } })),
      docClient.send(new GetCommand({ TableName: tableName, Key: { key: 'active_model' } }))
    ]);

    return {
      provider: providerRes.Item?.value ?? LLMProvider.OPENAI,
      model: modelRes.Item?.value ?? OpenAIModel.GPT_5_4
    };
  } catch (e) {
    console.error('Error fetching config:', e);
    return { provider: 'OFFLINE', model: 'OFFLINE' };
  }
}

async function getSessionTitles() {
  try {
    const tableName = getResourceName('MemoryTable');
    if (!tableName) return {};
    
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    // Scan for all session metadata records across all users
    const res = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(userId, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'SESSIONS#'
      }
    }));
    
    const titles: Record<string, string> = {};
    res.Items?.forEach(item => {
      if (item.sessionId) {
        titles[item.sessionId] = item.title ?? 'Untitled Conversation';
      }
    });
    return titles;
  } catch (e) {
    console.error('Error fetching session titles:', e);
    return {};
  }
}

export default async function AnalyticsTab({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; nextToken?: string }>;
}) {
  const params = await searchParams;
  const [tracesResult, config, sessionTitles] = await Promise.all([
    getTraces(params.nextToken), 
    getConfig(), 
    getSessionTitles(),
  ]);

  const traces = tracesResult.items;
  const nextToken = tracesResult.nextToken;

  const validTabs = ['live', 'timeline', 'sessions', 'models', 'tools', 'agents'] as const;
  const initialTab = validTabs.includes(params.tab as typeof validTabs[number])
    ? params.tab as typeof validTabs[number]
    : undefined;

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
            <ExportTracesButton traces={traces} />
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
        <TraceIntelligenceView 
          initialTraces={traces} 
          sessionTitles={sessionTitles} 
          initialTab={initialTab} 
          nextToken={nextToken} 
        />
      </main>
  );
}
