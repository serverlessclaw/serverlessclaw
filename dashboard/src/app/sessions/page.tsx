import { getResourceName } from '@/lib/sst-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { Users, MessageSquare, Clock, Shield, Search as SearchIcon } from 'lucide-react';
import Link from 'next/link';
import ExportButton from './ExportButton';
import SessionPagination from './SessionPagination';

export const dynamic = 'force-dynamic';

function decodePaginationToken(token: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    return undefined;
  }
}

function encodePaginationToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

async function getSessions(nextToken?: string, query?: string) {
  try {
    const tableName = getResourceName('MemoryTable');
    if (!tableName) {
      console.error('MemoryTable name is missing from Resources');
      return { items: [], nextToken: undefined };
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    // Using TypeTimestampIndex GSI for efficient querying of 'SESSION' type
    const res = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'TypeTimestampIndex',
        KeyConditionExpression: '#tp = :tp',
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeNames: {
          '#tp': 'type',
        },
        ExpressionAttributeValues: {
          ':tp': 'SESSION',
          ':prefix': 'SESSIONS#',
        },
        ScanIndexForward: false, // Sort by timestamp DESC
        Limit: 12,
        ExclusiveStartKey: nextToken ? decodePaginationToken(nextToken) : undefined,
      })
    );

    let items = res.Items ?? [];

    // Simple client-side search for title/ID if query provided
    if (query) {
      const searchStr = query.toLowerCase();
      items = items.filter(
        (s) =>
          s.title?.toLowerCase().includes(searchStr) ||
          s.sessionId?.toLowerCase().includes(searchStr)
      );
    }

    const encodedNext = res.LastEvaluatedKey
      ? encodePaginationToken(res.LastEvaluatedKey)
      : undefined;

    return { items, nextToken: encodedNext };
  } catch (e) {
    console.error('Error fetching sessions:', e);
    return { items: [], nextToken: undefined };
  }
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; next?: string }>;
}) {
  const params = await searchParams;
  const { items: sessions, nextToken: next } = await getSessions(params.next, params.q);

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div className="flex-1 min-w-0">
          <Typography variant="h2" color="white" glow uppercase>
            Multi-Human Sessions
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Monitor and manage active collaboration sessions across all human participants.
          </Typography>
        </div>
        <div className="flex gap-4 items-end">
          <div className="relative w-64 group">
            <form action="/sessions" method="GET">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-cyber-blue transition-colors">
                <SearchIcon size={14} />
              </div>
              <input
                name="q"
                type="text"
                placeholder="Search sessions..."
                defaultValue={params.q}
                className="w-full bg-white/5 border border-white/5 rounded h-[34px] pl-9 pr-3 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-cyber-blue/30 focus:bg-white/[0.08] transition-all"
              />
            </form>
          </div>
          <div className="flex flex-col items-center text-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
            >
              PAGE_RESULTS
            </Typography>
            <Badge variant="primary" className="px-4 py-1 font-black text-xs">
              {sessions.length}
            </Badge>
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
                <div className="flex items-center gap-2">
                  <ExportButton
                    sessionId={session.sessionId}
                    sessionTitle={session.title || 'Untitled Conversation'}
                  />
                  {session.isPinned && (
                    <Badge variant="intel" className="text-[9px] uppercase tracking-tighter">
                      PINNED
                    </Badge>
                  )}
                </div>
              </div>

              <div>
                <Typography
                  variant="h3"
                  className="line-clamp-1 group-hover:text-cyber-blue transition-colors"
                >
                  {session.title || 'Untitled Conversation'}
                </Typography>
                <Typography
                  variant="mono"
                  color="muted"
                  className="text-[10px] block mt-1 opacity-50 line-clamp-1"
                >
                  {session.lastMessage || `ID: ${session.sessionId}`}
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
                    {new Date(session.updatedAt || session.timestamp).toLocaleDateString()}
                  </Typography>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Shield size={14} className="text-cyber-blue/60" />
                <Typography
                  variant="mono"
                  className="text-[10px] text-cyber-blue/60 uppercase tracking-widest"
                >
                  Workspace: {session.workspaceId || 'Default'}
                </Typography>
              </div>
            </div>
          </Link>
        ))}

        {sessions.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white/5 border border-dashed border-white/10 rounded-2xl">
            <Typography variant="body" color="muted">
              No active sessions found.
            </Typography>
          </div>
        )}
      </div>

      <SessionPagination nextToken={next} />
    </main>
  );
}
