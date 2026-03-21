import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { 
  Database, 
  Clock, 
  Brain,
  Search as SearchIcon,
  Trash2,
  TrendingUp,
  Lightbulb,
  Target,
  BarChart2,
  Zap,
  Filter
} from 'lucide-react';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import MemoryPrioritySelector from '@/components/MemoryPrioritySelector';
import MemoryTabs from './MemoryTabs';
import MemorySearch from './MemorySearch';
import MemoryPagination from './MemoryPagination';

interface MemoryMetadata {
  priority?: number;
  category?: string;
  impact?: number;
  hitCount?: number;
  lastAccessed?: number;
}

interface MemoryItem {
  userId: string;
  timestamp: number;
  content: string;
  metadata?: MemoryMetadata;
  type?: string;
}

async function getMemoryData(activeTab: string, query: string, nextToken?: string, subType?: string) {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const memory = new DynamoMemory();
  
  // 1. Fetch the dynamic registry of memory types
  const registeredTypes = await memory.getRegisteredMemoryTypes();
  const knownTypes = new Set(['DISTILLED', 'LESSON', 'GAP', 'SESSION', 'MEMORY:USER_PREFERENCE']);
  const dynamicTypes = registeredTypes.filter(type => !knownTypes.has(type));

  const parsedNext = nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined;

  // Handle Search Tab
  if (activeTab === 'search' || query) {
     const result = await memory.searchInsights(undefined, query, undefined, 20, parsedNext);
     return {
         items: result.items as MemoryItem[],
         nextToken: result.lastEvaluatedKey ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64') : undefined,
         counts: {
            facts: 0, lessons: 0, gaps: 0, dynamic: 0
         },
         dynamicTypes
     };
  }

  // Define counts fetcher (parallel)
  const countPromises = [
    memory.getMemoryByType('DISTILLED', 1),
    memory.getMemoryByType('LESSON', 1),
    memory.getMemoryByType('GAP', 1),
    ...dynamicTypes.map(t => memory.getMemoryByType(t, 1))
  ];
  
  // For pagination, we only fetch the active tab's data
  let items: MemoryItem[] = [];
  let next: Record<string, unknown> | undefined = undefined;

  if (activeTab === 'facts') {
      const res = await memory.getMemoryByTypePaginated('DISTILLED', 20, parsedNext);
      items = res.items as MemoryItem[];
      next = res.lastEvaluatedKey;
  } else if (activeTab === 'lessons') {
      const res = await memory.getMemoryByTypePaginated('LESSON', 20, parsedNext);
      items = res.items as MemoryItem[];
      next = res.lastEvaluatedKey;
  } else if (activeTab === 'gaps') {
      const res = await memory.getMemoryByTypePaginated('GAP', 20, parsedNext);
      items = res.items as MemoryItem[];
      next = res.lastEvaluatedKey;
  } else if (activeTab === 'dynamic') {
      const typeToFetch = subType || dynamicTypes[0];
      if (typeToFetch) {
        const res = await memory.getMemoryByTypePaginated(typeToFetch, 20, parsedNext);
        items = res.items as MemoryItem[];
        next = res.lastEvaluatedKey;
      }
  }

  // Get total counts for badges (limit to a reasonable number or just check existence)
  // Real implementation might need a dedicated count metadata record for performance
  const countResults = await Promise.all(countPromises);

  return {
    items,
    nextToken: next ? Buffer.from(JSON.stringify(next)).toString('base64') : undefined,
    dynamicTypes,
    counts: {
        facts: countResults[0].length > 0 ? '50+' : 0, // Placeholder for real counts
        lessons: countResults[1].length > 0 ? '50+' : 0,
        gaps: countResults[2].length > 0 ? '50+' : 0,
        dynamic: dynamicTypes.length
    }
  };
}

async function pruneMemory(formData: FormData) {
  'use server';
  const userId = formData.get('userId') as string;
  const timestamp = parseInt(formData.get('timestamp') as string);

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  await docClient.send(new DeleteCommand({
    TableName: (Resource as { MemoryTable: { name: string } }).MemoryTable.name,
    Key: { userId, timestamp }
  }));

  revalidatePath('/memory');
}

/** MemoryVault — tiered memory inspector. Supports human-in-the-loop prioritisation and memory pruning. */
export default async function MemoryVault({ 
    searchParams 
}: { 
    searchParams: Promise<{ tab?: string, q?: string, next?: string, type?: string }> 
}) {
  const params = await searchParams;
  const query = params.q || '';
  const activeTab = query ? 'search' : (params.tab || 'facts');
  const nextToken = params.next;
  const subType = params.type;

  const { items, nextToken: next, dynamicTypes } = await getMemoryData(activeTab, query, nextToken, subType);
  
  const tabs = [
    { id: 'facts', label: 'Distilled Facts', count: items.length, icon: <Brain size={14} /> },
    { id: 'lessons', label: 'Tactical Lessons', count: items.length, icon: <Lightbulb size={14} /> },
    { id: 'gaps', label: 'Strategic Gaps', count: items.length, icon: <Target size={14} /> },
  ];

  if (dynamicTypes.length > 0) {
    tabs.push({ id: 'dynamic', label: 'Miscellaneous', count: dynamicTypes.length, icon: <Database size={14} /> });
  }

  if (query) {
    tabs.unshift({ id: 'search', label: 'Search Results', count: items.length, icon: <SearchIcon size={14} /> });
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-8 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-white/5 pb-8 gap-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Neural Reserve
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Human-Agent Collaborative Memory Tiering & Prioritization Hub.
          </Typography>
        </div>
        <MemorySearch />
      </header>

      <MemoryTabs tabs={tabs} />

      <div className="max-w-6xl animate-in fade-in slide-in-from-bottom-2 duration-500 min-h-[400px]">
        {/* Dynamic Types Sub-navigation */}
        {activeTab === 'dynamic' && (
          <div className="flex flex-wrap gap-2 mb-8 p-4 bg-white/[0.02] border border-white/5 rounded-lg">
             <div className="flex items-center gap-2 mr-4 opacity-50">
                <Filter size={14} className="text-purple-400" />
                <Typography variant="mono" className="text-[10px] uppercase font-bold tracking-widest">Type Filter:</Typography>
             </div>
             {dynamicTypes.map(type => (
                 <Link 
                    key={type} 
                    href={`/memory?tab=dynamic&type=${type}`}
                    className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                        (subType === type || (!subType && dynamicTypes[0] === type))
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                        : 'bg-white/5 text-muted hover:bg-white/10 hover:text-white border border-transparent'
                    }`}
                 >
                    {type.replace('MEMORY:', '').replace(/_/g, ' ')}
                 </Link>
             ))}
          </div>
        )}

        {items.length === 0 ? (
          <Card variant="solid" padding="lg" className="h-64 flex flex-col items-center justify-center opacity-20 border-dashed">
            <SearchIcon size={48} className="mb-4 text-muted" />
            <Typography variant="caption" uppercase className="tracking-[0.3em]">No memory records found in this sector</Typography>
            {query && <Typography variant="body" color="muted" className="mt-2">Try adjusting your search query or filters.</Typography>}
          </Card>
        ) : (
          <div className="grid gap-6">
            {items.map((item, i) => (
                <Card 
                  key={`${item.userId}-${item.timestamp}-${i}`} 
                  variant={activeTab === 'facts' ? 'solid' : 'glass'} 
                  padding="md" 
                  className={`group relative overflow-hidden transition-all hover:border-white/20 ${
                    item.metadata?.priority && item.metadata.priority >= 8 ? 'ring-1 ring-amber-500/30' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <Badge 
                                variant={
                                    item.userId.startsWith('GAP') ? 'danger' : 
                                    item.userId.startsWith('LESSON') ? 'primary' : 
                                    item.userId.startsWith('DISTILLED') ? 'intel' : 'audit'
                                }
                                className="uppercase tracking-widest px-3"
                            >
                                {item.metadata?.category || item.type?.replace('MEMORY:', '') || 'UNKNOWN'}
                            </Badge>
                            <Typography variant="mono" color="muted" className="text-[9px] opacity-40 uppercase tracking-tighter">
                                ID :: {item.userId.split('#')[1] || item.userId}
                            </Typography>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MemoryPrioritySelector 
                            userId={item.userId} 
                            timestamp={item.timestamp} 
                            currentPriority={item.metadata?.priority ?? 5} 
                        />
                        <form action={pruneMemory}>
                            <input type="hidden" name="userId" value={item.userId} />
                            <input type="hidden" name="timestamp" value={item.timestamp} />
                            <Button variant="ghost" size="sm" type="submit" className="text-white/50 hover:text-red-500 p-0 h-auto" icon={<Trash2 size={14} />} />
                        </form>
                    </div>
                  </div>

                  <Typography variant="body" color="white" className="leading-relaxed relative z-10 block whitespace-pre-wrap pr-10">
                     {activeTab === 'facts' || item.userId.startsWith('DISTILLED') ? <span className="italic opacity-80">&quot;{item.content}&quot;</span> : item.content}
                  </Typography>

                  <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-6 relative z-10 opacity-50 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-2">
                         <BarChart2 size={12} className="text-cyber-blue" />
                         <Typography variant="mono" className="text-[10px] uppercase tracking-widest">Utility: {item.metadata?.hitCount ?? 0}</Typography>
                      </div>
                      <div className="flex items-center gap-2">
                         <Clock size={12} />
                         <Typography variant="mono" className="text-[10px] uppercase tracking-widest">Last Recalled: {item.metadata?.lastAccessed ? new Date(item.metadata.lastAccessed).toLocaleDateString() : 'Never'}</Typography>
                      </div>
                      {item.metadata?.impact && (
                        <div className="flex items-center gap-2">
                            <TrendingUp size={12} className="text-cyber-green" />
                            <Typography variant="mono" className="text-[10px] uppercase tracking-widest">Impact: {item.metadata.impact}/10</Typography>
                        </div>
                      )}
                  </div>

                  {/* High Priority Accent */}
                  {item.metadata?.priority && item.metadata.priority >= 8 && (
                      <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none overflow-hidden">
                          <div className="absolute top-[-25px] right-[-25px] w-[50px] h-[50px] bg-amber-500 rotate-45 flex items-end justify-center pb-1 shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                              <Zap size={10} className="text-black" />
                          </div>
                      </div>
                  )}
                </Card>
            ))}
          </div>
        )}

        <MemoryPagination nextToken={next} />
      </div>
    </main>
  );
}
