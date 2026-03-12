import { NextResponse } from 'next/server';
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';

/**
 * Returns public configuration for the dashboard.
 * Safe to call from client components.
 */
export async function GET() {
  try {
    return NextResponse.json({
      realtime: {
        url: (Resource as any).RealtimeBus.url,
      }
    });
  } catch (error) {
    console.error('[Config API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}
