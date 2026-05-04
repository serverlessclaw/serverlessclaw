import { getResourceName } from '@/lib/sst-utils';
import { decodePaginationToken, encodePaginationToken } from '@/lib/pagination-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { Users, MessageSquare, Clock, Shield, Search as SearchIcon } from 'lucide-react';
import Link from 'next/link';
import ExportButton from './ExportButton';
import SessionPagination from './SessionPagination';
import PageHeader from '@/components/PageHeader';
import { logger } from '@claw/core/lib/logger';

export const dynamic = 'force-dynamic';

async function getSessions(nextToken?: string, query?: string) {
  try {
    const tableName = getResourceName('MemoryTable');
    if (!tableName) {
      logger.error('MemoryTable name is missing from Resources');
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
    logger.error('Error fetching sessions:', e);
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
    <div className="flex-1 space-y-10">
      <PageHeader
        titleKey="SESSIONS_TITLE"
        subtitleKey="SESSIONS_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                TOTAL
              </Typography>
              <Badge variant="primary" className="px-4 py-1 font-black text-xs">
                {sessions.length}
              </Badge>
            </div>
          </div>
        }
      >
        <div className="relative w-64 group">
          <form action="/sessions" method="GET">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-more group-focus-within:text-cyber-blue transition-colors">
              <SearchIcon size={14} />
            </div>
            <input
              name="q"
              type="text"
              placeholder="Search sessions..."
              defaultValue={params.q}
              className="w-full bg-input border border-input rounded h-[34px] pl-9 pr-3 text-xs font-mono text-foreground placeholder:text-muted-more/40 focus:outline-none focus:border-cyber-blue/30 focus:bg-background transition-all"
            />
          </form>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {sessions.map((session) => (
          <Link
            key={session.sessionId}
            href={`/chat?sessionId=${session.sessionId}`}
            className="group bg-card/60 backdrop-blur-xl border border-border p-6 rounded-xl hover:border-cyber-blue/40 transition-all duration-300 relative overflow-hidden"
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
                  color="muted-more"
                  className="text-[10px] block mt-1 line-clamp-1"
                >
                  {session.lastMessage || `ID: ${session.sessionId}`}
                </Typography>
              </div>

              <div className="pt-4 border-t border-border grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-muted-more" />
                  <Typography variant="mono" className="text-[11px] text-muted">
                    {session.participantCount || 1} Participants
                  </Typography>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-muted-more" />
                  <Typography variant="mono" className="text-[11px] text-muted">
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
          <div className="col-span-full py-20 text-center bg-card/20 border border-dashed border-border rounded-2xl">
            <Typography variant="body" color="muted">
              No active sessions found.
            </Typography>
          </div>
        )}
      </div>

      <SessionPagination nextToken={next} />
    </div>
  );
}
