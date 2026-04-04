import { getResourceName } from '@/lib/sst-utils';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Database, Brain, Search as SearchIcon, Lightbulb, Target, Filter } from 'lucide-react';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import MemoryTabs from './MemoryTabs';
import MemorySearch from './MemorySearch';
import MemoryPagination from './MemoryPagination';
import MemoryTable from './MemoryTable';
import { headers } from 'next/headers';

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
  createdAt: number;
  content: string;
  metadata?: MemoryMetadata;
  type?: string;
}

function decodePaginationToken(token: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    return undefined;
  }
}

function encodePaginationToken(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function coerceToMemoryItem(item: unknown): MemoryItem | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (!obj.userId || !obj.timestamp) return null;
  return {
    userId: String(obj.userId),
    timestamp: Number(obj.timestamp),
    createdAt: Number(obj.createdAt ?? 0),
    content: String(obj.content ?? ''),
    metadata: obj.metadata as MemoryMetadata | undefined,
    type: obj.type as string | undefined,
  };
}

async function getMemoryData(
  activeTab: string,
  query: string,
  nextToken?: string,
  subType?: string
) {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const memory = new DynamoMemory();

  // 1. Fetch the dynamic registry of memory types
  let registeredTypes: string[] = [];
  try {
    registeredTypes = await memory.getRegisteredMemoryTypes();
  } catch (err) {
    console.error('[MemoryVault] Failed to fetch registered memory types:', err);
  }

  const knownTypes = new Set(['DISTILLED', 'LESSON', 'GAP', 'SESSION']);

  // FALLBACK DISCOVERY: If registry is empty, try to find types via a shallow scan
  if (registeredTypes.length === 0) {
    try {
      const client = new DynamoDBClient({});
      const docClient = DynamoDBDocumentClient.from(client);
      const { Items } = await docClient.send(
        new ScanCommand({
          TableName: getResourceName('MemoryTable') ?? '',
          ProjectionExpression: '#tp',
          ExpressionAttributeNames: { '#tp': 'type' },
          Limit: 100,
        })
      );
      if (Items) {
        registeredTypes = Array.from(new Set(Items.map((i) => i.type).filter(Boolean)));
      }
    } catch (err) {
      console.error('[MemoryVault] Fallback type discovery failed:', err);
    }
  }

  const dynamicTypes = registeredTypes.filter((type) => !knownTypes.has(type)).sort();

  const parsedNext = decodePaginationToken(nextToken ?? '');

  // Handle Search Tab
  if (query) {
    try {
      const result = await memory.searchInsights(undefined, query, undefined, 20, parsedNext);
      return {
        items: (result.items || []).map(coerceToMemoryItem).filter(Boolean) as MemoryItem[],
        nextToken: encodePaginationToken(result.lastEvaluatedKey),
        counts: {
          facts: 0,
          lessons: 0,
          gaps: 0,
          dynamic: 0,
        },
        dynamicTypes,
      };
    } catch (err) {
      console.error('[MemoryVault] Search failed:', err);
      return {
        items: [],
        nextToken: undefined,
        counts: { facts: 0, lessons: 0, gaps: 0, dynamic: 0 },
        dynamicTypes,
      };
    }
  }

  // Define counts fetcher (parallel with individual error boundaries)
  const countPromises = [
    memory.getMemoryByType('DISTILLED', 50).catch((e) => {
      console.error('Count error DISTILLED:', e);
      return [];
    }),
    Promise.all([
      memory.getMemoryByType('LESSON', 50).catch((e) => {
        console.error('Count error LESSON:', e);
        return [];
      }),
      memory.getMemoryByType('lesson', 50).catch((e) => {
        console.error('Count error lesson:', e);
        return [];
      }),
    ]).then(([a, b]) => [...a, ...b]),
    memory.getMemoryByType('GAP', 50).catch((e) => {
      console.error('Count error GAP:', e);
      return [];
    }),
    ...dynamicTypes.map((t) =>
      memory.getMemoryByType(t, 50).catch((e) => {
        console.error(`Count error ${t}:`, e);
        return [];
      })
    ),
  ];

  // For pagination, we only fetch the active tab's data
  let items: MemoryItem[] = [];
  let next: Record<string, unknown> | undefined = undefined;

  try {
    if (activeTab === 'facts') {
      const res = await memory.getMemoryByTypePaginated('DISTILLED', 20, parsedNext);
      items = (res.items || []).map(coerceToMemoryItem).filter(Boolean) as MemoryItem[];
      next = res.lastEvaluatedKey;
    } else if (activeTab === 'lessons') {
      // Fetch from all three lesson sources sequentially to build a proper merged cursor
      const [resNew, resLegacy, resStandard] = await Promise.all([
        memory
          .getMemoryByTypePaginated('LESSON', 20, parsedNext)
          .catch(() => ({ items: [], lastEvaluatedKey: undefined })),
        memory
          .getMemoryByTypePaginated('lesson', 20, parsedNext)
          .catch(() => ({ items: [], lastEvaluatedKey: undefined })),
        memory
          .getMemoryByTypePaginated('MEMORY:TACTICAL_LESSSON', 20, parsedNext)
          .catch(() => ({ items: [], lastEvaluatedKey: undefined })),
      ]);
      const allItems = [
        ...(resNew.items || []).map(coerceToMemoryItem).filter(Boolean),
        ...(resLegacy.items || []).map(coerceToMemoryItem).filter(Boolean),
        ...(resStandard.items || []).map(coerceToMemoryItem).filter(Boolean),
      ]
        .filter((item): item is MemoryItem => item !== null)
        .sort((a, b) => b.timestamp - a.timestamp);
      items = allItems.slice(0, 20);
      // Use the last item's key as the cursor for the merged result
      if (allItems.length > 20) {
        const lastItem = allItems[19];
        next = { userId: lastItem.userId, timestamp: lastItem.timestamp };
      } else {
        next =
          (resNew as { lastEvaluatedKey?: Record<string, unknown> }).lastEvaluatedKey ||
          (resLegacy as { lastEvaluatedKey?: Record<string, unknown> }).lastEvaluatedKey ||
          (resStandard as { lastEvaluatedKey?: Record<string, unknown> }).lastEvaluatedKey;
      }
    } else if (activeTab === 'gaps') {
      const res = await memory.getMemoryByTypePaginated('GAP', 20, parsedNext);
      items = (res.items || []).map(coerceToMemoryItem).filter(Boolean) as MemoryItem[];
      next = res.lastEvaluatedKey;
    } else if (activeTab === 'dynamic') {
      const typeToFetch = subType || dynamicTypes[0];
      if (typeToFetch) {
        const res = await memory.getMemoryByTypePaginated(typeToFetch, 20, parsedNext);
        items = (res.items || []).map(coerceToMemoryItem).filter(Boolean) as MemoryItem[];
        next = res.lastEvaluatedKey;
      }
    }
  } catch (err) {
    console.error(`[MemoryVault] Failed to fetch items for tab ${activeTab}:`, err);
  }

  const countResults = await Promise.all(countPromises);
  const formatCount = (arr: unknown) =>
    Array.isArray(arr) && arr.length >= 50 ? '50+' : Array.isArray(arr) ? arr.length : 0;

  const dynamicCounts = countResults.slice(3);
  const totalDynamic = dynamicCounts.reduce(
    (acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0),
    0
  );

  return {
    items,
    nextToken: encodePaginationToken(next),
    dynamicTypes,
    counts: {
      facts: formatCount(countResults[0]),
      lessons: formatCount(countResults[1]),
      gaps: formatCount(countResults[2]),
      dynamic:
        totalDynamic >= 50 * dynamicTypes.length && dynamicTypes.length > 0 ? '50+' : totalDynamic,
    },
  };
}

async function pruneMemory(formData: FormData) {
  'use server';
  const headersList = await headers();
  const host = headersList.get('host');
  if (!host || !host.startsWith('localhost')) {
    throw new Error('Unauthorized: memory operations require local access');
  }

  const userId = formData.get('userId') as string;
  const timestamp = parseInt(formData.get('timestamp') as string);

  if (!userId || isNaN(timestamp)) {
    throw new Error('Invalid memory key');
  }

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  await docClient.send(
    new DeleteCommand({
      TableName: getResourceName('MemoryTable') ?? '',
      Key: { userId, timestamp },
    })
  );

  revalidatePath('/memory');
}

async function bulkPruneMemory(keys: Array<{ userId: string; timestamp: number }>) {
  'use server';
  const headersList = await headers();
  const host = headersList.get('host');
  if (!host || !host.startsWith('localhost')) {
    throw new Error('Unauthorized: memory operations require local access');
  }

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);
  const tableName = getResourceName('MemoryTable');

  if (!tableName) throw new Error('MemoryTable not found');

  await Promise.all(
    keys.map((key) =>
      docClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { userId: key.userId, timestamp: key.timestamp },
        })
      )
    )
  );

  revalidatePath('/memory');
}

async function updateMemoryContent(formData: FormData) {
  'use server';
  const headersList = await headers();
  const host = headersList.get('host');
  if (!host || !host.startsWith('localhost')) {
    throw new Error('Unauthorized: memory operations require local access');
  }

  const userId = formData.get('userId') as string;
  const timestamp = parseInt(formData.get('timestamp') as string);
  const content = formData.get('content') as string;
  const isJson = formData.get('isJson') === 'true';

  if (!userId || isNaN(timestamp)) {
    throw new Error('Invalid memory key');
  }

  if (content.length > 100_000) {
    throw new Error('Content exceeds maximum length of 100,000 characters');
  }

  if (isJson) {
    try {
      JSON.parse(content);
    } catch (e) {
      console.error('Invalid JSON content for memory update:', e);
      throw new Error('Content must be valid JSON');
    }
  }

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  await docClient.send(
    new UpdateCommand({
      TableName: getResourceName('MemoryTable') ?? '',
      Key: { userId, timestamp },
      UpdateExpression: 'SET content = :c',
      ExpressionAttributeValues: {
        ':c': content,
      },
    })
  );

  revalidatePath('/memory');
}

/** MemoryVault — tiered memory inspector. Supports human-in-the-loop prioritisation and memory pruning. */
export default async function MemoryVault({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; next?: string; type?: string }>;
}) {
  const params = await searchParams;
  const query = params.q || '';
  const activeTab = query ? 'search' : params.tab || 'facts';
  const nextToken = params.next;
  const subType = params.type;

  const {
    items,
    nextToken: next,
    dynamicTypes,
    counts,
  } = await getMemoryData(activeTab, query, nextToken, subType);

  const tabs = [
    { id: 'facts', label: 'Distilled Facts', count: counts.facts, icon: <Brain size={14} /> },
    {
      id: 'lessons',
      label: 'Tactical Lessons',
      count: counts.lessons,
      icon: <Lightbulb size={14} />,
    },
    { id: 'gaps', label: 'Strategic Gaps', count: counts.gaps, icon: <Target size={14} /> },
  ];

  if (dynamicTypes.length > 0) {
    tabs.push({
      id: 'dynamic',
      label: 'Dynamic Memory',
      count: counts.dynamic,
      icon: <Database size={14} />,
    });
  }

  if (query) {
    tabs.unshift({
      id: 'search',
      label: 'Search Results',
      count: items.length,
      icon: <SearchIcon size={14} />,
    });
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div className="flex-1 min-w-0">
          <Typography variant="h2" color="white" glow uppercase>
            Neural Reserve
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block lg:whitespace-nowrap">
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
              <Typography
                variant="mono"
                className="text-[10px] uppercase font-bold tracking-widest"
              >
                Type Filter:
              </Typography>
            </div>
            {dynamicTypes.map((type) => (
              <Link
                key={type}
                href={`/memory?tab=dynamic&type=${type}`}
                className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                  subType === type || (!subType && dynamicTypes[0] === type)
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
          <Card
            variant="solid"
            padding="lg"
            className="h-64 flex flex-col items-center justify-center opacity-20 border-dashed"
          >
            <SearchIcon size={48} className="mb-4 text-muted" />
            <Typography variant="caption" uppercase className="tracking-[0.3em]">
              No memory records found in this sector
            </Typography>
            {query && (
              <Typography variant="body" color="muted" className="mt-2">
                Try adjusting your search query or filters.
              </Typography>
            )}
          </Card>
        ) : (
          <MemoryTable
            items={items}
            pruneAction={pruneMemory}
            updateAction={updateMemoryContent}
            bulkPruneAction={bulkPruneMemory}
          />
        )}

        <MemoryPagination nextToken={next} />
      </div>
    </main>
  );
}
