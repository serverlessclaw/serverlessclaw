import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { 
  AlertCircle, 
  Kanban
} from 'lucide-react';
import { GapStatus } from '@claw/core/lib/types';
import { revalidatePath } from 'next/cache';
import PipelineBoard from './PipelineBoard';
import { DynamoMemory } from '@claw/core/lib/memory';
import { GapItem } from '@claw/core/lib/types/memory';




async function getGaps(): Promise<GapItem[]> {
  try {
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('GAP#');
    return (items as GapItem[] ?? []).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  } catch (e) {
    console.error('Error fetching gaps:', e);
    return [];
  }
}


async function updateStatus(gapId: string, status: string) {
  'use server';
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    await memory.updateGapStatus(gapId, status as GapStatus);
    revalidatePath('/pipeline');
  } catch (e) {
    console.error('Error updating gap status:', e);
  }
}

async function pruneGap(gapId: string, timestamp: number) {
  'use server';
  try {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    await docClient.send(new DeleteCommand({
      TableName: (Resource as Record<string, { name: string }>).MemoryTable.name,
      Key: { userId: gapId, timestamp }
    }));
    
    revalidatePath('/pipeline');
  } catch (e) {
    console.error('Error pruning gap:', e);
  }
}

async function triggerBatchEvolution(gapIds: string[]) {
  'use server';
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const { emitEvent } = await import('@claw/core/lib/utils/bus');
    
    const memory = new DynamoMemory();
    
    for (const gapId of gapIds) {
      const numericId = gapId.split('#')[1];
      const plan = await memory.getDistilledMemory(`PLAN#${numericId}`);
      
      if (plan) {
        // Dispatch task to Coder
        await emitEvent('pipeline.dashboard', 'coder_task', {
          userId: 'SYSTEM#GLOBAL',
          task: plan,
          metadata: {
            gapIds: [gapId],
          },
          source: 'pipeline'
        });
        
        // Update status to PROGRESS
        await memory.updateGapStatus(gapId, GapStatus.PROGRESS);
      } else {
        console.warn(`No plan found for gap ${gapId}, skipping evolution.`);
      }
    }
    
    revalidatePath('/pipeline');
  } catch (e) {
    console.error('Error triggering batch evolution:', e);
  }
}

/** EvolutionPipeline — visual Kanban board for the gap lifecycle. Supports batch advancement and manual pruning. */
export default async function EvolutionPipeline() {
  const gaps = await getGaps();
  
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

      <PipelineBoard 
        initialGaps={gaps} 
        updateStatus={updateStatus} 
        pruneGap={pruneGap} 
        triggerBatchEvolution={triggerBatchEvolution} 
      />

      <div className="glass-card p-4 border-white/5 bg-black/40 flex items-center gap-4">
        <AlertCircle size={18} className="text-amber-500/60" />
        <p className="text-[10px] text-white/50 italic leading-relaxed">
          [CONTROL_ADVISORY]: Strategic gaps are identified by the <span className="text-white/100">ST_PLANNER</span> agent. Batch evolution triggers the <span className="text-white/100">CODER</span> agent for selected <span className="text-white/100">READY</span> gaps.
        </p>
      </div>
    </main>
  );
}
