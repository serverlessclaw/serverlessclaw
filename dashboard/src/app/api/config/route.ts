import { NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';

/**
 * Returns public configuration for the dashboard.
 * Safe to call from client components.
 */
export async function GET() {
  try {
    const realtime = (Resource as any).RealtimeBus;
    const rawRealtimeUrl = realtime?.url ?? realtime?.endpoint ?? null;
    const realtimeUrl =
      typeof rawRealtimeUrl === 'string'
        ? rawRealtimeUrl.startsWith('wss://')
          ? rawRealtimeUrl
          : rawRealtimeUrl.startsWith('https://')
            ? rawRealtimeUrl.replace('https://', 'wss://')
            : `wss://${rawRealtimeUrl}`
        : null;

    if (!realtimeUrl) {
      console.warn('[Config API] RealtimeBus is not linked; realtime URL is unavailable');
    }

    return NextResponse.json({
      realtime: {
        url: realtimeUrl,
      },
    });
  } catch (error) {
    console.error('[Config API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}
