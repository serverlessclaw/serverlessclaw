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
  Target
} from 'lucide-react';
import { tools } from '@/lib/tool-definitions';
import { revalidatePath } from 'next/cache';

async function getMemoryData() {
  try {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: Resource.MemoryTable.name,
      })
    );
    
    return Items || [];
  } catch (e) {
    console.error('Error fetching memory data:', e);
    return [];
  }
}

async function pruneMemory(formData: FormData) {
  'use server';
  const userId = formData.get('userId') as string;
  const timestamp = parseInt(formData.get('timestamp') as string);

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  await docClient.send(new DeleteCommand({
    TableName: Resource.MemoryTable.name,
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

export default async function MemoryVault() {
  const allItems = await getMemoryData();
  
  const distilled = allItems
    .filter(item => item.userId?.startsWith('DISTILLED#'))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const lessons = allItems
    .filter(item => item.userId?.startsWith('LESSON#') || item.userId?.startsWith('TACTICAL#'))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const gaps = allItems
    .filter(item => item.userId?.startsWith('GAP#'))
    .sort((a, b) => {
      const prioA = a.metadata?.priority ?? 5;
      const prioB = b.metadata?.priority ?? 5;
      if (prioA !== prioB) return prioB - prioA;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
    
  const sessions = Array.from(new Set(allItems
    .filter(item => !item.userId?.includes('#') && item.timestamp)
    .map(item => item.userId)))
    .map(userId => ({
      userId,
      lastActive: Math.max(...allItems
        .filter(item => item.userId === userId)
        .map(item => item.timestamp || 0))
    }))
    .sort((a, b) => b.lastActive - a.lastActive);

  const toolList = Object.values(tools);

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text-blue uppercase">NEURAL_RESERVE</h2>
          <p className="text-white/100 text-sm mt-2 font-light">Human-Agent Collaborative Memory Tiering & Prioritization Hub.</p>
        </div>
        <div className="flex gap-4 text-center">
            <div className="glass-card px-4 py-2 text-[10px]">
                <div className="text-white/90 mb-1 uppercase font-bold tracking-widest">Facts</div>
                <div className="font-bold text-cyber-blue text-lg">{distilled.length}</div>
            </div>
            <div className="glass-card px-4 py-2 text-[10px]">
                <div className="text-white/90 mb-1 uppercase font-bold tracking-widest">Lessons</div>
                <div className="font-bold text-cyber-green text-lg">{lessons.length}</div>
            </div>
            <div className="glass-card px-4 py-2 text-[10px]">
                <div className="text-white/90 mb-1 uppercase font-bold tracking-widest">Gaps</div>
                <div className="font-bold text-amber-500 text-lg">{gaps.length}</div>
            </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
        <div className="xl:col-span-8 space-y-12">
          {/* Strategic Gaps - Prioritization Hub */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-500/60 flex items-center gap-2">
                <Target size={14} className="text-amber-500" /> Strategic Capability Gaps (Co-Managed)
              </h3>
              <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest bg-white/5 px-2 py-1 rounded">
                Collaboration Mode: Active
              </div>
            </div>
            <div className="grid gap-4">
              {gaps.length > 0 ? (
                gaps.map((gap, i) => (
                    <div key={i} className={`glass-card p-5 border-amber-500/10 bg-amber-500/[0.02] group relative overflow-hidden ${gap.metadata?.priority >= 8 ? 'ring-1 ring-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : ''}`}>
                        <div className="absolute -right-8 -top-8 w-24 h-24 bg-amber-500/5 rotate-45 border border-amber-500/10"></div>
                        
                        <div className="flex justify-between items-start mb-3 relative z-10">
                            <div className="flex flex-col gap-1">
                              <div className="text-[10px] text-amber-500 font-bold uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded w-fit">
                                  {gap.metadata?.category || 'STRATEGIC_GAP'}
                              </div>
                              <span className="text-[9px] text-white/50 font-mono">ID: {gap.userId.split('#')[1]}</span>
                            </div>
                            
                            <div className="flex items-center gap-4">
                               <form action={prioritizeMemory} className="flex items-center gap-2 bg-black/40 px-2 py-1 rounded border border-white/5">
                                  <input type="hidden" name="userId" value={gap.userId} />
                                  <input type="hidden" name="timestamp" value={gap.timestamp} />
                                  <label className="text-[9px] text-white/90 uppercase font-bold tracking-tighter">Prio:</label>
                                  <select 
                                    name="priority" 
                                    defaultValue={gap.metadata?.priority || 5}
                                    onBlur={(e) => e.target.form?.requestSubmit()}
                                    className="bg-transparent text-amber-400 text-[10px] font-bold outline-none cursor-pointer"
                                  >
                                    {[1,2,3,4,5,6,7,8,9,10].map(p => (
                                      <option key={p} value={p} className="bg-[#1a1a1a]">{p}</option>
                                    ))}
                                  </select>
                               </form>

                               <form action={pruneMemory} className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <input type="hidden" name="userId" value={gap.userId} />
                                  <input type="hidden" name="timestamp" value={gap.timestamp} />
                                  <button type="submit" className="text-white/50 hover:text-red-500 transition-colors">
                                      <Trash2 size={14} />
                                  </button>
                               </form>
                            </div>
                        </div>

                        <p className="text-sm text-white/90 font-medium leading-relaxed pr-8 relative z-10">
                            {gap.content}
                        </p>

                        <div className="mt-4 flex gap-4 text-[9px] text-white/90 uppercase font-mono relative z-10 border-t border-white/5 pt-3">
                            <div className="flex items-center gap-1.5">
                              <TrendingUp size={10} className="text-cyber-green" /> 
                              <span>Impact: {gap.metadata?.impact || 5}/10</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock size={10} />
                              <span>Detected: {new Date(gap.timestamp).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                ))
              ) : (
                <div className="h-24 flex items-center justify-center text-white/10 border border-dashed border-white/5 rounded">
                   <p className="text-[10px] tracking-widest uppercase">Autonomous self-assessment: complete. No major gaps detected.</p>
                </div>
              )}
            </div>
          </section>

          {/* Tactical Lessons - Focus Mode */}
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-cyber-green/60 flex items-center gap-2 mb-6">
              <Lightbulb size={14} className="text-cyber-green" /> Tactical Lessons (Heuristics)
            </h3>
            <div className="grid gap-3">
              {lessons.length > 0 ? (
                lessons.map((lesson, i) => (
                  <div key={i} className={`glass-card p-4 border-cyber-green/10 bg-cyber-green/[0.02] group relative ${lesson.metadata?.priority >= 8 ? 'bg-cyber-green/[0.05] border-cyber-green/30' : ''}`}>
                    <div className="flex justify-between items-start">
                      <div className="text-[9px] text-cyber-green/50 font-bold mb-1 uppercase tracking-tighter">
                        NEURAL_CORRECTION :: {lesson.userId.split('#')[1]}
                        {lesson.metadata?.priority >= 8 && <span className="ml-2 text-cyber-green bg-cyber-green/10 px-1 rounded">HOT_PATH</span>}
                      </div>

                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <form action={prioritizeMemory}>
                          <input type="hidden" name="userId" value={lesson.userId} />
                          <input type="hidden" name="timestamp" value={lesson.timestamp} />
                          <input type="hidden" name="priority" value={lesson.metadata?.priority >= 8 ? 5 : 10} />
                          <button type="submit" className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border transition-colors ${lesson.metadata?.priority >= 8 ? 'bg-cyber-green text-black border-cyber-green' : 'text-cyber-green border-cyber-green/30 hover:bg-cyber-green/10'}`}>
                            {lesson.metadata?.priority >= 8 ? 'UNFOCUS' : 'FOCUS'}
                          </button>
                        </form>
                        
                        <form action={pruneMemory}>
                            <input type="hidden" name="userId" value={lesson.userId} />
                            <input type="hidden" name="timestamp" value={lesson.timestamp} />
                            <button type="submit" className="text-white/50 hover:text-red-500 transition-colors">
                                <Trash2 size={14} />
                            </button>
                        </form>
                      </div>
                    </div>
                    <p className="text-sm text-white/90 leading-relaxed font-mono italic mt-1">
                       "{lesson.content}"
                    </p>
                  </div>
                ))
              ) : (
                <div className="h-20 flex items-center justify-center text-white/10 border border-dashed border-white/5 rounded">
                  <p className="text-[10px] tracking-widest">NO_TACTICAL_LESSONS_INDEXED</p>
                </div>
              )}
            </div>
          </section>

          {/* Distilled Facts */}
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-cyber-blue/60 flex items-center gap-2 mb-6">
              <Brain size={14} className="text-cyber-blue" /> Distilled Neural Constants
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {distilled.length > 0 ? (
                distilled.map((fact, i) => (
                  <div key={i} className="glass-card p-4 border-cyber-blue/10 bg-cyber-blue/[0.01] relative group">
                    <form action={pruneMemory} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <input type="hidden" name="userId" value={fact.userId} />
                        <input type="hidden" name="timestamp" value={fact.timestamp} />
                        <button type="submit" className="text-white/50 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                        </button>
                    </form>
                    <div className="text-[10px] text-cyber-blue/40 font-bold mb-2 uppercase tracking-tight">
                      {fact.userId.replace('DISTILLED#', 'CONST::')}
                    </div>
                    <p className="text-[11px] text-white/70 leading-relaxed italic">
                      {fact.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="h-32 col-span-2 flex flex-col items-center justify-center text-white/10 border border-dashed border-white/5 rounded-lg">
                  <Search size={24} className="mb-2 opacity-10" />
                  <p className="text-xs">NO_DISTILLED_FACTS_FOUND</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right: Arsenal & Sessions */}
        <div className="xl:col-span-4 space-y-10">
          <section className="glass-card p-6 border-white/10 bg-black/40">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2">
                <Wrench size={14} className="text-yellow-500" /> Active Arsenal
              </h3>
              <span className="text-[8px] text-cyber-green font-bold animate-pulse">CAPABLE</span>
            </div>
            <div className="space-y-3">
              {toolList.slice(0, 12).map((tool, i) => (
                <div key={i} className="px-3 py-2 bg-white/[0.02] border border-white/5 rounded flex items-center justify-between group">
                  <span className="text-[11px] font-bold text-white/100 group-hover:text-yellow-500/80 transition-colors uppercase tracking-tight">{tool.name}</span>
                  <Shield size={10} className="text-white/10 group-hover:text-cyber-green" />
                </div>
              ))}
              {toolList.length > 12 && (
                <div className="text-center text-[9px] text-white/50 pt-2 border-t border-white/5 mt-4 capitalize font-mono">
                  + {toolList.length - 12} more specialized nodes
                </div>
              )}
            </div>
          </section>

          <section className="glass-card p-6 border-white/5 bg-black/20">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/90 flex items-center gap-2 mb-6">
              <History size={14} className="text-white/90" /> Cognitive Sessions
            </h3>
            <div className="space-y-3">
              {sessions.map((session, i) => (
                <div key={i} className="flex justify-between items-center text-[10px] p-2.5 hover:bg-white/5 rounded transition-colors group border border-transparent hover:border-white/5">
                  <span className="text-white/50 truncate max-w-[120px] font-mono uppercase tracking-tighter">{session.userId}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-white/50 font-mono group-hover:text-cyber-green">{new Date(session.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <div className="w-1 h-1 bg-cyber-green rounded-full shadow-[0_0_5px_rgba(52,211,153,0.5)]"></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
