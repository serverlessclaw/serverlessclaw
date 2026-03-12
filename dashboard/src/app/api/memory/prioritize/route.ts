import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { DynamoMemory } from '@claw/core/lib/memory';
import { HTTP_STATUS } from '@/lib/constants';

/**
 * POST handler for prioritizing memory insights.
 * Updates the metadata (priority, urgency, impact) for a specific memory insight.
 * 
 * @param req - The incoming NextRequest containing the update parameters.
 * @returns A promise that resolves to a NextResponse indicating success or failure.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, timestamp, priority, urgency, impact } = await req.json();

    if (!userId || !timestamp) {
      return NextResponse.json(
        { error: 'Missing required parameters: userId and timestamp are mandatory.' }, 
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const memory = new DynamoMemory();
    
    // Update metadata
    await memory.updateInsightMetadata(userId, timestamp, {
      priority: typeof priority === 'number' ? (priority as number) : undefined,
      urgency: typeof urgency === 'number' ? (urgency as number) : undefined,
      impact: typeof impact === 'number' ? (impact as number) : undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Prioritize API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
