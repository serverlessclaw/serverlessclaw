import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { 
  Database, 
  History, 
  Wrench, 
  Clock, 
  Brain,
  Search,
  ChevronRight,
  Shield,
  Trash2,
  TrendingUp,
  Lightbulb,
  Target,
  BarChart2,
  Zap
} from 'lucide-react';
import { tools } from '@/lib/tool-definitions';
import { revalidatePath } from 'next/cache';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import MemoryPrioritySelector from '@/components/MemoryPrioritySelector';

async function getMemoryData() {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const memory = new DynamoMemory();
  
  // 1. Fetch the dynamic registry of memory types
  const registeredTypes = await memory.getRegisteredMemoryTypes();
  const knownTypes = new Set(['DISTILLED', 'LESSON', 'GAP', 'SESSION', 'MEMORY:USER_PREFERENCE']);
  const dynamicTypes = registeredTypes.filter(type => !knownTypes.has(type));

  // 2. Build the parallel fetch queue
  const fetchPromises = [
    memory.getMemoryByType('DISTILLED', 50),
    memory.getMemoryByType('MEMORY:USER_PREFERENCE', 50),
    memory.getMemoryByType('LESSON', 50),
    memory.getMemoryByType('GAP', 50),
    memory.getMemoryByType('SESSION', 50),
    ...dynamicTypes.map(t => memory.getMemoryByType(t, 20)) // Fetch a sensible limit for dynamic types
  ];

  // 3. Execute all queries in parallel
  const results = await Promise.all(fetchPromises);
  
  const distilled = results[0];
  const preferences = results[1];
  const lessons = results[2];
  const gaps = results[3];
  const sessions = results[4];

  // Group all dynamic types into a single structure
  const dynamicCategories: Record<string, any[]> = {};
  dynamicTypes.forEach((type, index) => {
    const items = results[5 + index];
    if (items && items.length > 0) {
      dynamicCategories[type] = items;
    }
  });

  // Merge preferences into distilled facts as they serve a similar UI purpose
  const allDistilled = [...distilled, ...preferences];

  // If we have no data at all, might be an old table without 'type' fields
  if (gaps.length === 0 && lessons.length === 0 && allDistilled.length === 0 && sessions.length === 0 && Object.keys(dynamicCategories).length === 0) {
    console.log('[MemoryVault] No typed data found, falling back to Scan for migration support');
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    let allItems: any[] = [];
    let lastKey: any = undefined;
    
    do {
      const { Items, LastEvaluatedKey } = await docClient.send(
        new ScanCommand({
          TableName: (Resource as any).MemoryTable.name,
          ExclusiveStartKey: lastKey,
          Limit: 100 // Limit scan per chunk to avoid timeout
        })
      );
      if (Items) allItems = [...allItems, ...Items];
      lastKey = LastEvaluatedKey;
    } while (lastKey && allItems.length < 500); // Guard rails
    
    return {
        distilled: allItems.filter(item => item.userId?.startsWith('DISTILLED#') || item.userId?.startsWith('USER#')),
        lessons: allItems.filter(item => item.userId?.startsWith('LESSON#') || item.userId?.startsWith('TACTICAL#')),
        gaps: allItems.filter(item => item.userId?.startsWith('GAP#')),
        sessions: Array.from(new Set(allItems
            .filter(item => !item.userId?.includes('#') && item.timestamp)
            .map(item => item.userId)))
            .map(userId => ({
            userId,
            lastActive: Math.max(...allItems
                .filter(item => item.userId === userId)
                .map(item => item.timestamp || 0))
            })),
        dynamicCategories: {}
    };
  }
  
  return { 
    distilled: allDistilled, 
    lessons, 
    dynamicCategories,
    gaps: gaps.sort((a, b) => {
      const prioA = a.metadata?.priority ?? 5;
      const prioB = b.metadata?.priority ?? 5;
      if (prioA !== prioB) return prioB - prioA;
      return (b.timestamp || 0) - (a.timestamp || 0);
    }), 
    sessions: sessions.map(s => ({
        userId: s.userId.replace('SESSIONS#', ''),
        lastActive: s.timestamp
    }))
  };
}

async function pruneMemory(formData: FormData) {
  'use server';
  const userId = formData.get('userId') as string;
  const timestamp = parseInt(formData.get('timestamp') as string);

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  await docClient.send(new DeleteCommand({
    TableName: (Resource as any).MemoryTable.name,
    Key: { userId, timestamp }
  }));

  revalidatePath('/memory');
}

async function prioritizeMemory(formData: FormData) {
  'use server';
  const userId = formData.get('userId') as string;
  const timestamp = parseInt(formData.get('timestamp') as string);
  const priority = parseInt(formData.get('priority') as string);

  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const memory = new DynamoMemory();
  
  await memory.updateInsightMetadata(userId, timestamp, { priority });

  revalidatePath('/memory');
}

/** MemoryVault — tiered memory inspector. Displays DISTILLED facts, tactical INSIGHTS, strategic GAPS, and agent SESSIONS. Supports human-in-the-loop prioritisation and memory pruning. */
export default async function MemoryVault() {
  const { distilled, lessons, gaps, sessions, dynamicCategories } = await getMemoryData();
  
  const toolList = Object.values(tools);

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Neural Reserve
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Human-Agent Collaborative Memory Tiering & Prioritization Hub.
          </Typography>
        </div>
        <div className="flex gap-4 text-center">
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">FACTS</Typography>
                <Badge variant="primary" className="px-4 py-1 font-black text-xs">{distilled.length}</Badge>
            </div>
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">LESSONS</Typography>
                <Badge variant="primary" className={`px-4 py-1 font-black text-xs bg-blue-500/10 text-blue-400 border-blue-500/20`}>{lessons.length}</Badge>
            </div>
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">GAPS</Typography>
                <Badge variant="primary" className={`px-4 py-1 font-black text-xs bg-red-500/10 text-red-400 border-red-500/20`}>{gaps.length}</Badge>
            </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
        <div className="xl:col-span-8 space-y-12">
          {/* Strategic Gaps - Prioritization Hub */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <Typography variant="h3" color="danger" weight="bold" uppercase className="flex items-center gap-2 opacity-60">
                <Target size={14} className="text-amber-500" /> Strategic Capability Gaps (Co-Managed)
              </Typography>
              <Badge variant="primary" className="opacity-50">
                Collaboration Mode: Active
              </Badge>
            </div>
            <div className="grid gap-4">
              {gaps.length > 0 ? (
                gaps.map((gap, i) => (
                    <Card key={i} variant="glass" padding="md" className={`border-amber-500/10 bg-amber-500/[0.02] group relative overflow-hidden ${gap.metadata?.priority >= 8 ? 'ring-1 ring-amber-500/30' : ''}`}>
                        <div className="absolute -right-8 -top-8 w-24 h-24 bg-amber-500/5 rotate-45 border border-amber-500/10"></div>
                        
                        <div className="flex justify-between items-start mb-3 relative z-10">
                            <div className="flex flex-col gap-1">
                              <Badge variant="primary" className="bg-amber-500/10 text-amber-500">
                                  {gap.metadata?.category || 'STRATEGIC_GAP'}
                              </Badge>
                              <Typography variant="mono" color="muted" className="text-[9px]">ID: {gap.userId.split('#')[1]}</Typography>
                            </div>
                            
                             <div className="flex items-center gap-4">
                                <MemoryPrioritySelector 
                                  userId={gap.userId} 
                                  timestamp={gap.timestamp} 
                                  currentPriority={gap.metadata?.priority || 5} 
                                />

                               <form action={pruneMemory} className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <input type="hidden" name="userId" value={gap.userId} />
                                  <input type="hidden" name="timestamp" value={gap.timestamp} />
                                  <Button variant="ghost" size="sm" type="submit" className="text-white/50 hover:text-red-500 p-0 h-auto" icon={<Trash2 size={14} />} />
                               </form>
                            </div>
                        </div>

                        <Typography variant="body" color="white" weight="medium" className="leading-relaxed pr-8 relative z-10 block">
                            {gap.content}
                        </Typography>

                         <div className="mt-4 flex gap-4 relative z-10 border-t border-white/5 pt-3">
                             <div className="flex items-center gap-1.5">
                               <TrendingUp size={10} className="text-cyber-green" /> 
                               <Typography variant="mono" color="muted" className="text-[9px]" uppercase>Impact: {gap.metadata?.impact || 5}/10</Typography>
                             </div>
                             <div className="flex items-center gap-1.5">
                               <Clock size={10} className="text-white/50" />
                               <Typography variant="mono" color="muted" className="text-[9px]" uppercase>Detected: {new Date(gap.timestamp).toLocaleDateString()}</Typography>
                             </div>
                         </div>
                    </Card>
                ))
               ) : (
                <Card variant="solid" padding="md" className="h-24 flex items-center justify-center opacity-20 border-dashed">
                   <Typography variant="caption" uppercase className="tracking-widest">Autonomous self-assessment: complete. No major gaps detected.</Typography>
                </Card>
              )}
            </div>
          </section>

          {/* Tactical Lessons - Focus Mode */}
          <section>
            <Typography variant="caption" weight="black" uppercase className="tracking-[0.2em] flex items-center gap-2 mb-6 text-cyber-green opacity-60">
              <Lightbulb size={14} className="text-cyber-green" /> Tactical Lessons (Heuristics)
            </Typography>
            <div className="grid gap-3">
              {lessons.length > 0 ? (
                lessons.map((lesson, i) => (
                  <Card key={i} variant="glass" padding="md" className={`border-cyber-green/10 bg-cyber-green/[0.02] group relative ${lesson.metadata?.priority >= 8 ? 'bg-cyber-green/[0.05] border-cyber-green/30' : ''}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col gap-1 mb-2">
                        <Typography variant="mono" color="primary" weight="bold" uppercase className="text-[9px] tracking-tighter opacity-50 block">
                          NEURAL_CORRECTION :: {lesson.userId.split('#')[1]}
                        </Typography>
                        {lesson.metadata?.priority >= 8 && <Badge variant="primary">HOT_PATH</Badge>}
                      </div>

                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <form action={prioritizeMemory}>
                          <input type="hidden" name="userId" value={lesson.userId} />
                          <input type="hidden" name="timestamp" value={lesson.timestamp} />
                          <input type="hidden" name="priority" value={lesson.metadata?.priority >= 8 ? 5 : 10} />
                          <Button variant={lesson.metadata?.priority >= 8 ? 'primary' : 'outline'} size="sm" type="submit" uppercase className="text-[9px] px-2 h-auto">
                            {lesson.metadata?.priority >= 8 ? 'UNFOCUS' : 'FOCUS'}
                          </Button>
                        </form>
                        
                        <form action={pruneMemory}>
                            <input type="hidden" name="userId" value={lesson.userId} />
                            <input type="hidden" name="timestamp" value={lesson.timestamp} />
                            <Button variant="ghost" size="sm" type="submit" className="text-white/50 hover:text-red-500 p-0 h-auto" icon={<Trash2 size={14} />} />
                        </form>
                      </div>
                    </div>
                    <Typography variant="body" color="white" italic className="leading-relaxed opacity-90 block mt-1">
                       "{lesson.content}"
                    </Typography>
                    
                    <div className="mt-3 flex gap-3 opacity-60">
                      <div className="flex items-center gap-1">
                        <BarChart2 size={10} />
                        <Typography variant="mono" className="text-[8px] uppercase">Recalls: {lesson.metadata?.hitCount || 0}</Typography>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={10} />
                        <Typography variant="mono" className="text-[8px] uppercase">Last: {lesson.metadata?.lastAccessed ? new Date(lesson.metadata.lastAccessed).toLocaleDateString() : 'Never'}</Typography>
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <Card variant="solid" padding="md" className="h-20 flex items-center justify-center opacity-20 border-dashed">
                  <Typography variant="caption" uppercase className="tracking-widest">NO_TACTICAL_LESSONS_INDEXED</Typography>
                </Card>
              )}
            </div>
          </section>

          {/* Distilled Facts */}
          <section>
            <Typography variant="caption" weight="black" uppercase className="tracking-[0.2em] flex items-center gap-2 mb-6 text-cyber-blue opacity-60">
              <Brain size={14} className="text-cyber-blue" /> Distilled Neural Constants
            </Typography>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {distilled.length > 0 ? (
                distilled.map((fact, i) => (
                  <Card key={i} variant="solid" padding="sm" className="relative group border-cyber-blue/10 bg-cyber-blue/[0.01]">
                    <form action={pruneMemory} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <input type="hidden" name="userId" value={fact.userId} />
                        <input type="hidden" name="timestamp" value={fact.timestamp} />
                        <Button variant="ghost" size="sm" type="submit" className="text-white/50 hover:text-red-500 p-0 h-auto" icon={<Trash2 size={14} />} />
                    </form>
                    <Typography variant="caption" weight="bold" color="intel" uppercase className="mb-2 block opacity-40">
                      {fact.userId.replace('DISTILLED#', 'CONST::')}
                    </Typography>
                    <Typography variant="body" color="white" italic className="leading-relaxed opacity-70 block">
                      {fact.content}
                    </Typography>

                    <div className="mt-4 pt-2 border-t border-white/5 flex gap-3 opacity-40">
                      <div className="flex items-center gap-1">
                        <Zap size={10} className="text-cyber-blue" />
                        <Typography variant="mono" className="text-[8px] uppercase">Utility: {fact.metadata?.hitCount || 0}</Typography>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={10} />
                        <Typography variant="mono" className="text-[8px] uppercase">Last Recalled: {fact.metadata?.lastAccessed ? new Date(fact.metadata.lastAccessed).toLocaleDateString() : 'Never'}</Typography>
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <Card variant="solid" padding="lg" className="h-32 col-span-2 flex flex-col items-center justify-center opacity-20 border-dashed">
                  <Search size={24} className="mb-2" />
                  <Typography variant="caption" uppercase>NO_DISTILLED_FACTS_FOUND</Typography>
                </Card>
              )}
            </div>
          </section>

          {/* Dynamically Discovered Knowledge Types */}
          {Object.entries(dynamicCategories || {}).map(([type, items]) => (
            <section key={type}>
              <Typography variant="caption" weight="black" uppercase className="tracking-[0.2em] flex items-center gap-2 mb-6 text-purple-400 opacity-60">
                <Database size={14} className="text-purple-400" /> {type.replace('MEMORY:', '').replace(/_/g, ' ')}
              </Typography>
              <div className="grid grid-cols-1 gap-4">
                {items.map((item, i) => (
                  <Card key={i} variant="solid" padding="sm" className={`relative group border-purple-500/10 bg-purple-500/[0.01] ${!item.metadata?.hitCount ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                    <form action={pruneMemory} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <input type="hidden" name="userId" value={item.userId} />
                        <input type="hidden" name="timestamp" value={item.timestamp} />
                        <Button variant="ghost" size="sm" type="submit" className="text-white/50 hover:text-red-500 p-0 h-auto" icon={<Trash2 size={14} />} />
                    </form>
                    <div className="flex flex-col gap-1 mb-2">
                        <Typography variant="mono" color="intel" weight="bold" uppercase className="text-[9px] tracking-tighter opacity-50 block">
                          ID :: {item.userId.split('#')[1]}
                        </Typography>
                    </div>
                    <Typography variant="body" color="white" className="leading-relaxed opacity-80 block whitespace-pre-wrap">
                      {item.content}
                    </Typography>

                    <div className="mt-4 pt-2 border-t border-white/5 flex gap-4 opacity-40">
                      <div className="flex items-center gap-1">
                        <BarChart2 size={10} className="text-purple-400" />
                        <Typography variant="mono" className="text-[8px] uppercase">Hits: {item.metadata?.hitCount || 0}</Typography>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={10} />
                        <Typography variant="mono" className="text-[8px] uppercase">Last: {item.metadata?.lastAccessed ? new Date(item.metadata.lastAccessed).toLocaleDateString() : 'Never'}</Typography>
                      </div>
                      {!item.metadata?.hitCount && (
                        <div className="ml-auto flex items-center gap-1 text-amber-500/60">
                          <Typography variant="mono" className="text-[8px] uppercase">STALE_CANDIDATE</Typography>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Right: Arsenal & Sessions */}
        <div className="xl:col-span-4 space-y-10">
          <Card variant="glass" padding="lg" className="border-white/10 bg-black/40">
            <div className="flex items-center justify-between mb-6">
              <Typography variant="caption" weight="black" uppercase className="tracking-[0.2em] flex items-center gap-2">
                <Wrench size={14} className="text-yellow-500" /> Active Arsenal
              </Typography>
              <Typography variant="mono" weight="bold" color="primary" className="text-[8px] animate-pulse">CAPABLE</Typography>
            </div>
            <div className="space-y-3">
              {toolList.slice(0, 12).map((tool, i) => (
                <div key={i} className="px-3 py-2 bg-white/[0.02] border border-white/5 rounded flex items-center justify-between group">
                  <Typography variant="caption" weight="bold" color="white" uppercase className="tracking-tight group-hover:text-yellow-500/80 transition-colors">
                    {tool.name}
                  </Typography>
                  <Shield size={10} className="text-white/10 group-hover:text-cyber-green" />
                </div>
              ))}
              {toolList.length > 12 && (
                <Typography variant="mono" color="muted" className="text-center text-[9px] pt-2 border-t border-white/5 mt-4 block capitalize">
                  + {toolList.length - 12} more specialized nodes
                </Typography>
              )}
            </div>
          </Card>

          <Card variant="glass" padding="lg" className="border-white/5 bg-black/20">
            <Typography variant="caption" weight="black" uppercase className="tracking-[0.2em] flex items-center gap-2 mb-6 opacity-60">
              <History size={14} /> Cognitive Sessions
            </Typography>
            <div className="space-y-3">
              {sessions.map((session, i) => (
                <div key={i} className="flex justify-between items-center text-[10px] p-2.5 hover:bg-white/5 rounded transition-colors group border border-transparent hover:border-white/5">
                  <Typography variant="mono" color="muted" className="truncate max-w-[120px] tracking-tighter uppercase">{session.userId}</Typography>
                  <div className="flex items-center gap-3">
                    <Typography variant="mono" color="muted" className="group-hover:text-cyber-green">{new Date(session.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Typography>
                    <div className="w-1 h-1 bg-cyber-green rounded-full shadow-[0_0_5px_rgba(52,211,153,0.5)]"></div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
