import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { HTTP_STATUS } from '@/lib/constants';

/**
 * POST handler for creating a new capability gap from the dashboard.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const { details, metadata } = await req.json();

    if (!details) {
      return NextResponse.json(
        { error: 'Missing required parameter: details is mandatory.' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const memory = new DynamoMemory();
    const gapId = Date.now().toString();
    
    // Record the gap
    await memory.setGap(gapId, details, metadata);

    console.log(`[Gap API] Recorded strategic gap: ${gapId}`);

    return NextResponse.json({ success: true, gapId });
  } catch (error) {
    console.error('Gap Creation API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
