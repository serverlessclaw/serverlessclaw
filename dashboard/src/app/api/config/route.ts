import { NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';

/**
 * Returns public configuration for the dashboard.
 * Safe to call from client components.
 */
export async function GET() {
  try {
    const realtime = Resource.RealtimeBus;
    const realtimeUrl =
      typeof realtime.endpoint === 'string'
        ? realtime.endpoint.startsWith('wss://')
          ? realtime.endpoint
          : realtime.endpoint.startsWith('https://')
            ? realtime.endpoint.replace('https://', 'wss://')
            : `wss://${realtime.endpoint}`
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
