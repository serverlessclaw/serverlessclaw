import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { HTTP_STATUS } from '@/lib/constants';

/**
 * POST handler for updating the status of a capability gap.
 * 
 * @param req - The incoming NextRequest containing the gapId and new status.
 * @returns A promise that resolves to a NextResponse indicating success or failure.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const { GapStatus } = await import('@claw/core/lib/types');
    const { gapId, status } = await req.json();

    if (!gapId || !status) {
      return NextResponse.json(
        { error: 'Missing required parameters: gapId and status are mandatory.' }, 
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Validate status
    if (!Object.values(GapStatus).includes(status as typeof GapStatus[keyof typeof GapStatus])) {
      return NextResponse.json(
        { error: `Invalid status: ${status}. Must be one of ${Object.values(GapStatus).join(', ')}` },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const memory = new DynamoMemory();
    
    // Update status
    await memory.updateGapStatus(gapId, status as typeof GapStatus[keyof typeof GapStatus]);

    return NextResponse.json({ success: true, gapId, status });
  } catch (error) {
    console.error('Gap Status Update API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
