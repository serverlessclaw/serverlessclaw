import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { Users, MessageSquare, Clock, Shield } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function getSessions() {
  try {
    const typedResource = Resource as unknown as { MemoryTable?: { name: string } };
    const tableName = typedResource.MemoryTable?.name;
    if (!tableName) {
      console.error('MemoryTable name is missing from Resources');
      return [];
    }
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
    
    return (res.Items ?? []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch (e) {
    console.error('Error fetching sessions:', e);
    return [];
  }
}

export default async function SessionsPage() {
  const sessions = await getSessions();

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Multi-Human Sessions
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Monitor and manage active collaboration sessions across all human participants.
          </Typography>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col items-center text-center">
            <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">TOTAL_SESSIONS</Typography>
            <Badge variant="primary" className="px-4 py-1 font-black text-xs">{sessions.length}</Badge>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {sessions.map((session) => (
          <Link 
            key={session.sessionId} 
            href={`/chat?sessionId=${session.sessionId}`}
            className="group bg-white/5 border border-white/10 p-6 rounded-xl hover:border-cyber-blue/40 transition-all duration-300 relative overflow-hidden"
          >
            {/* Background Glow */}
            <div className="absolute -right-10 -top-10 w-32 h-32 bg-cyber-blue/10 rounded-full blur-3xl group-hover:bg-cyber-blue/20 transition-all" />
            
            <div className="relative z-10 space-y-4">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-cyber-blue/10 rounded-lg text-cyber-blue">
                  <MessageSquare size={20} />
                </div>
                {session.isPinned && (
                  <Badge variant="intel" className="text-[9px] uppercase tracking-tighter">PINNED</Badge>
                )}
              </div>

              <div>
                <Typography variant="h3" className="line-clamp-1 group-hover:text-cyber-blue transition-colors">
                  {session.title || 'Untitled Conversation'}
                </Typography>
                <Typography variant="mono" color="muted" className="text-[10px] block mt-1 opacity-50">
                  ID: {session.sessionId}
                </Typography>
              </div>

              <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-white/40" />
                  <Typography variant="mono" className="text-[11px] text-white/60">
                    {session.participantCount || 1} Participants
                  </Typography>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-white/40" />
                  <Typography variant="mono" className="text-[11px] text-white/60">
                    {new Date(session.timestamp).toLocaleDateString()}
                  </Typography>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Shield size={14} className="text-cyber-blue/60" />
                <Typography variant="mono" className="text-[10px] text-cyber-blue/60 uppercase tracking-widest">
                  Workspace: {session.workspaceId || 'Default'}
                </Typography>
              </div>
            </div>
          </Link>
        ))}

        {sessions.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white/5 border border-dashed border-white/10 rounded-2xl">
            <Typography variant="body" color="muted">No active sessions found.</Typography>
          </div>
        )}
      </div>
    </main>
  );
}
