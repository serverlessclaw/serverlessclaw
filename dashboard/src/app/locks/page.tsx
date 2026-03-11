import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { Lock, Unlock, Clock, ShieldAlert, RefreshCw, Zap } from 'lucide-react';
import { revalidatePath } from 'next/cache';

async function getLocks() {
  try {
    const tableName = Resource.MemoryTable?.name;
    if (!tableName) {
      console.error('MemoryTable name is missing from Resources');
      return [];
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: {
          ':prefix': 'LOCK#',
        },
      })
    );
    
    return (Items || []).map(item => ({
      lockId: item.userId.replace('LOCK#', ''),
      rawId: item.userId,
      expiresAt: item.expiresAt,
      acquiredAt: item.acquiredAt,
      timestamp: item.timestamp,
      isExpired: item.expiresAt < Math.floor(Date.now() / 1000)
    })).sort((a, b) => b.acquiredAt - a.acquiredAt);
  } catch (e) {
    console.error('Error fetching locks:', e);
    return [];
  }
}

async function forceUnlock(rawId: string) {
  'use server';
  try {
    const tableName = Resource.MemoryTable?.name;
    if (!tableName) {
      throw new Error('MemoryTable name is missing from Resources');
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: {
          userId: rawId,
          timestamp: 0,
        },
      })
    );
    
    revalidatePath('/locks');
  } catch (e) {
    console.error('Error forcing unlock:', e);
  }
}

export default async function LocksPage() {
  const locks = await getLocks();

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text-orange">SESSION_TRAFFIC</h2>
          <p className="text-white/100 text-sm mt-2 font-light">Real-time distributed lock manager for session isolation.</p>
        </div>
        <div className="flex gap-4">
          <div className="glass-card px-4 py-2 text-[12px]">
            <div className="text-white/90 mb-1">ACTIVE_LOCKS</div>
            <div className="font-bold text-orange-500">{locks.filter(l => !l.isExpired).length}</div>
          </div>
          <div className="glass-card px-4 py-2 text-[12px]">
            <div className="text-white/90 mb-1">ZOMBIE_LOCKS</div>
            <div className="font-bold text-white/100">{locks.filter(l => l.isExpired).length}</div>
          </div>
        </div>
      </header>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2">
                <Zap size={14} className="text-orange-500" /> Lane Concurrency Monitor
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-white/50 uppercase font-mono">
                <RefreshCw size={10} className="animate-spin-slow" /> Auto-Refresh Active
            </div>
        </div>

        <div className="grid gap-4">
          {locks.length > 0 ? (
            locks.map((lock, i) => (
              <div 
                key={i} 
                className={`glass-card p-6 flex justify-between items-center border-l-4 transition-all ${
                  lock.isExpired ? 'border-l-white/10 opacity-60' : 'border-l-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.05)]'
                }`}
              >
                <div className="flex gap-6 items-center">
                    <div className={`w-10 h-10 rounded flex items-center justify-center ${
                        lock.isExpired ? 'bg-white/5 text-white/50' : 'bg-orange-500/10 text-orange-500'
                    }`}>
                        <Lock size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-white/90">SESSION::{lock.lockId}</span>
                            {lock.isExpired && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-white/90 font-bold uppercase">Expired</span>
                            )}
                        </div>
                        <div className="flex gap-6 mt-2">
                            <div className="text-[10px] text-white/90 flex items-center gap-1.5">
                                <Clock size={12} /> Acquired: {new Date(lock.acquiredAt).toLocaleTimeString()}
                            </div>
                            <div className="text-[10px] text-white/90 flex items-center gap-1.5">
                                <ShieldAlert size={12} /> TTL: {new Date(lock.expiresAt * 1000).toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                </div>

                <form action={forceUnlock.bind(null, lock.rawId)}>
                    <button 
                        type="submit"
                        className="flex items-center gap-2 px-4 py-2 rounded border border-red-500/20 text-red-400 text-[10px] font-bold hover:bg-red-500/10 transition-colors group cursor-pointer"
                    >
                        <Unlock size={14} className="group-hover:rotate-12 transition-transform" /> FORCE_RELEASE
                    </button>
                </form>
              </div>
            ))
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-white/50 border border-dashed border-white/10 rounded-lg">
                <Unlock size={32} className="mb-4 opacity-10" />
                <p className="text-sm font-light">ALL_LANES_CLEAR // NO_ACTIVE_SESSIONS</p>
                <p className="text-[10px] mt-2 opacity-50">System is idle.</p>
            </div>
          )}
        </div>
      </section>

      <div className="p-6 rounded border border-orange-500/10 bg-orange-500/[0.02] max-w-2xl">
        <h4 className="text-[10px] uppercase font-bold text-orange-500 mb-2 flex items-center gap-2">
            <ShieldAlert size={12} /> Recovery Protocol
        </h4>
        <p className="text-xs text-white/100 leading-relaxed italic">
            "Ghost Locks" occur when an agent crashes before releasing its session. Force releasing a lock allows the user to start a new session immediately. Caution: Releasing an active lock may cause state corruption.
        </p>
      </div>
    </main>
  );
}
