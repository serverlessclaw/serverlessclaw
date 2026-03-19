import { NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';

/**
 * Returns public configuration for the dashboard.
 * Safe to call from client components.
 */
export async function GET() {
  try {
    const realtimeUrl = (Resource as any).RealtimeBus?.url ?? null;

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
