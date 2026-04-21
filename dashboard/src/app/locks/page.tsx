import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Lock, Unlock, Clock, ShieldAlert, RefreshCw, Zap } from 'lucide-react';

import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { deleteMemoryItem } from '@/lib/actions/dynamodb-actions';
import { getResourceName } from '@/lib/sst-utils';
import PageHeader from '@/components/PageHeader';
import { logger } from '@claw/core/lib/logger';

async function getLocks() {
  try {
    const tableName = getResourceName('MemoryTable');
    if (!tableName) {
      logger.error('MemoryTable name is missing from Resources and Environment');
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

    return (Items ?? [])
      .map((item) => ({
        lockId: item.userId.replace('LOCK#', ''),
        rawId: item.userId,
        expiresAt: item.expiresAt,
        acquiredAt: item.acquiredAt,
        timestamp: item.timestamp,
        isExpired: item.expiresAt < Math.floor(Date.now() / 1000),
      }))
      .sort((a, b) => b.acquiredAt - a.acquiredAt);
  } catch (e) {
    logger.error('Error fetching locks:', e);
    return [];
  }
}

async function forceUnlock(rawId: string) {
  'use server';
  try {
    await deleteMemoryItem(rawId, 0, '/locks');
  } catch (e) {
    logger.error('Error forcing unlock:', e);
  }
}

/** LocksPage — lists active DynamoDB session locks managed by DynamoLockManager and allows manual force-unlock, giving operators visibility into concurrent session state. */
export default async function LocksPage() {
  const locks = await getLocks();

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-500/5 via-transparent to-transparent">
      <PageHeader
        titleKey="LOCKS_TITLE"
        subtitleKey="LOCKS_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <Card variant="glass" padding="sm" className="px-4 py-2 min-w-[120px] bg-card/40">
              <Typography variant="mono" color="muted-more" className="mb-1 block">
                ACTIVE_LOCKS
              </Typography>
              <Typography variant="h3" weight="bold" className="text-orange-500">
                {locks.filter((l) => !l.isExpired).length}
              </Typography>
            </Card>
            <Card variant="glass" padding="sm" className="px-4 py-2 min-w-[120px] bg-card/40">
              <Typography variant="mono" color="muted-more" className="mb-1 block">
                ZOMBIE_LOCKS
              </Typography>
              <Typography variant="h3" weight="bold">
                {locks.filter((l) => l.isExpired).length}
              </Typography>
            </Card>
          </div>
        }
      />

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <Typography
            variant="caption"
            weight="black"
            className="tracking-[0.2em] flex items-center gap-2"
          >
            <Zap size={14} className="text-orange-500" /> Lane Concurrency Monitor
          </Typography>
          <div className="flex items-center gap-2">
            <RefreshCw size={10} className="animate-spin-slow text-muted-more" />
            <Typography variant="mono" color="muted-more">
              Auto-Refresh Active
            </Typography>
          </div>
        </div>

        <div className="grid gap-4">
          {locks.length > 0 ? (
            locks.map((lock, i) => (
              <Card
                key={i}
                variant="glass"
                padding="lg"
                className={`flex justify-between items-center border-l-4 transition-all bg-card/60 ${
                  lock.isExpired
                    ? 'border-l-border opacity-60'
                    : 'border-l-orange-500 shadow-premium'
                }`}
              >
                <div className="flex gap-6 items-center">
                  <div
                    className={`w-10 h-10 rounded flex items-center justify-center ${
                      lock.isExpired
                        ? 'bg-foreground/5 text-muted-more'
                        : 'bg-orange-500/10 text-orange-500'
                    }`}
                  >
                    <Lock size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <Typography variant="caption" weight="bold">
                        SESSION::{lock.lockId}
                      </Typography>
                      {lock.isExpired && (
                        <Badge variant="danger" className="text-[9px] px-1.5 py-0.5">
                          Expired
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-6 mt-2">
                      <Typography
                        variant="mono"
                        color="muted-more"
                        className="flex items-center gap-1.5 text-[10px]"
                      >
                        <Clock size={12} /> Acquired:{' '}
                        {new Date(lock.acquiredAt).toLocaleTimeString()}
                      </Typography>
                      <Typography
                        variant="mono"
                        color="muted-more"
                        className="flex items-center gap-1.5 text-[10px]"
                      >
                        <ShieldAlert size={12} /> TTL:{' '}
                        {new Date(lock.expiresAt * 1000).toLocaleTimeString()}
                      </Typography>
                    </div>
                  </div>
                </div>

                <form action={forceUnlock.bind(null, lock.rawId)}>
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    icon={
                      <Unlock size={14} className="group-hover:rotate-12 transition-transform" />
                    }
                  >
                    Force Release
                  </Button>
                </form>
              </Card>
            ))
          ) : (
            <Card
              variant="solid"
              padding="lg"
              className="h-48 flex flex-col items-center justify-center opacity-50 border-dashed border-border bg-card/20"
            >
              <Unlock size={32} className="mb-4 text-muted-more" />
              <Typography variant="body" weight="normal" color="muted">
                All lanes clear // No active sessions
              </Typography>
              <Typography variant="caption" color="muted-more" className="mt-2 block">
                System is idle.
              </Typography>
            </Card>
          )}
        </div>
      </section>

      <Card
        variant="outline"
        padding="lg"
        className="border-orange-500/10 bg-orange-500/[0.02] max-w-2xl"
      >
        <Typography
          variant="caption"
          weight="bold"
          className="text-orange-500 mb-2 flex items-center gap-2"
        >
          <ShieldAlert size={12} /> Recovery Protocol
        </Typography>
        <Typography variant="body" italic className="leading-relaxed block">
          &quot;Ghost Locks&quot; occur when an agent crashes before releasing its session. Force
          releasing a lock allows the user to start a new session immediately. Caution: Releasing an
          active lock may cause state corruption.
        </Typography>
      </Card>
    </main>
  );
}
