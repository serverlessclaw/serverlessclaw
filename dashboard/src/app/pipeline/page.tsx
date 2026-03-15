import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { 
  GitBranch, 
  Target, 
  Rocket, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  ArrowRight,
  TrendingUp,
  Brain,
  ChevronRight,
  Kanban
} from 'lucide-react';
import { GapStatus } from '@claw/core/lib/types';
import { revalidatePath } from 'next/cache';

async function getGaps() {
  try {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: Resource.MemoryTable.name,
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: {
          ':prefix': 'GAP#',
        },
      })
    );
    
    return (Items || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch (e) {
    console.error('Error fetching gaps:', e);
    return [];
  }
}

async function updateStatus(formData: FormData) {
  'use server';
  const gapId = formData.get('gapId') as string;
  const status = formData.get('status') as string;

  try {
    // In a server component, we can call the API or the core logic directly
    // Using the API route via fetch for consistency or internal logic
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    await memory.updateGapStatus(gapId, status as any);
    
    revalidatePath('/pipeline');
  } catch (e) {
    console.error('Error updating gap status:', e);
  }
}

/** EvolutionPipeline — visual Kanban board for the gap lifecycle (OPEN → PLANNED → PROGRESS → DEPLOYED → DONE). Fetches gap records from DynamoDB and supports inline status advancement. */
export default async function EvolutionPipeline() {
  const gaps = await getGaps();
  
  const columns = [
    { status: GapStatus.OPEN, label: 'Identified', icon: Target, color: 'text-amber-500', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.2)]' },
    { status: GapStatus.PLANNED, label: 'Ready', icon: Brain, color: 'text-indigo-500', glow: 'shadow-[0_0_15px_rgba(99,102,241,0.2)]' },
    { status: GapStatus.PROGRESS, label: 'Evolution', icon: GitBranch, color: 'text-cyber-blue', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.2)]' },
    { status: GapStatus.DEPLOYED, label: 'Verified', icon: Rocket, color: 'text-purple-500', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.2)]' },
    { status: GapStatus.DONE, label: 'Closed', icon: CheckCircle2, color: 'text-cyber-green', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.2)]' },
  ];

  return (
    <main className="flex-1 overflow-x-auto p-10 space-y-8 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-amber-500/5 via-transparent to-transparent min-w-[1240px]">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Kanban size={24} className="text-amber-500" />
            <h2 className="text-3xl font-bold tracking-tight glow-text-amber uppercase">EVOLUTION_PIPELINE</h2>
          </div>
          <p className="text-white/100 text-sm font-light">Visual lifecycle management of autonomous system upgrades and capability gaps.</p>
        </div>
        <div className="flex gap-4">
            <div className="glass-card px-4 py-2 text-[10px] border-amber-500/20">
                <div className="text-white/50 mb-1 uppercase font-bold tracking-widest">Active Gaps</div>
                <div className="font-bold text-amber-500 text-lg">{gaps.filter(g => g.status !== GapStatus.DONE).length}</div>
            </div>
            <div className="glass-card px-4 py-2 text-[10px] border-cyber-green/20">
                <div className="text-white/50 mb-1 uppercase font-bold tracking-widest">Historical Success</div>
                <div className="font-bold text-cyber-green text-lg">{gaps.filter(g => g.status === GapStatus.DONE).length}</div>
            </div>
        </div>
      </header>

      <div className="grid grid-cols-5 gap-6 h-[calc(100vh-250px)]">
        {columns.map((col) => {
          const colGaps = gaps.filter(g => g.status === col.status);
          const Icon = col.icon;

          return (
            <div key={col.status} className="flex flex-col gap-4">
              <div className={`flex items-center justify-between p-3 glass-card border-white/5 bg-white/5 ${col.glow}`}>
                <div className="flex items-center gap-2">
                  <Icon size={16} className={col.color} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{col.label}</span>
                </div>
                <span className="text-[10px] font-mono text-white/40">{colGaps.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {colGaps.map((gap) => (
                  <div key={gap.userId} className="glass-card p-4 border-white/5 hover:border-white/20 transition-all group relative overflow-hidden bg-black/40">
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-[8px] font-mono text-white/30 uppercase">ID: {gap.userId.split('#')[1]}</div>
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyber-blue animate-pulse"></div>
                      </div>
                    </div>
                    
                    <p className="text-[11px] text-white/100 leading-relaxed font-medium mb-4 line-clamp-3">
                      {gap.content}
                    </p>

                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
                      <div className="flex items-center gap-2 text-[9px] text-white/40 font-mono">
                        <Clock size={10} />
                        {new Date(gap.timestamp).toLocaleDateString()}
                      </div>
                      
                      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {columns.find(c => {
                          const currentIndex = columns.findIndex(col => col.status === gap.status);
                          return columns.indexOf(c) === currentIndex + 1;
                        }) && (
                          <form action={updateStatus}>
                            <input type="hidden" name="gapId" value={gap.userId} />
                            <input type="submit" name="status" value={columns[columns.findIndex(c => c.status === gap.status) + 1].status} className="hidden" id={`next-${gap.userId}`} />
                            <label htmlFor={`next-${gap.userId}`} className="cursor-pointer text-[9px] font-bold bg-white/10 hover:bg-white/20 px-2 py-1 rounded flex items-center gap-1 transition-colors uppercase tracking-tight">
                              Advance <ArrowRight size={10} />
                            </label>
                          </form>
                        )}
                        {gap.status !== columns[0].status && (
                          <form action={updateStatus}>
                            <input type="hidden" name="gapId" value={gap.userId} />
                            <input type="submit" name="status" value={columns[columns.findIndex(c => c.status === gap.status) - 1].status} className="hidden" id={`prev-${gap.userId}`} />
                            <label htmlFor={`prev-${gap.userId}`} className="cursor-pointer text-[9px] font-bold text-white/40 hover:text-white/80 px-2 py-1 transition-colors uppercase tracking-tight">
                              Revert
                            </label>
                          </form>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex gap-3 text-[8px] text-white/30 uppercase font-bold tracking-tighter">
                        <div className="flex items-center gap-1">
                            <TrendingUp size={8} className="text-cyber-green" /> Imp: {gap.metadata?.impact || 5}
                        </div>
                        <div className="flex items-center gap-1">
                            <Brain size={8} className="text-amber-500" /> Prio: {gap.metadata?.priority || 5}
                        </div>
                    </div>
                  </div>
                ))}

                {colGaps.length === 0 && (
                  <div className="h-32 flex items-center justify-center text-white/5 border border-dashed border-white/5 rounded-lg">
                    <span className="text-[9px] uppercase tracking-widest font-bold">Terminal Empty</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card p-4 border-white/5 bg-black/40 flex items-center gap-4">
        <AlertCircle size={18} className="text-amber-500/60" />
        <p className="text-[10px] text-white/50 italic leading-relaxed">
          [CONTROL_ADVISORY]: Strategic gaps are identified by the <span className="text-white/100">ST_PLANNER</span> agent. Manual overrides in the pipeline directly influence the next evolution cycle. advancing a gap to <span className="text-white/100">READY</span> triggers logic generation.
        </p>
      </div>
    </main>
  );
}
