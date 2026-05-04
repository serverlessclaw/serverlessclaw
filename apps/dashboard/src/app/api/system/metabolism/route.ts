import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@claw/core/lib/logger';
import { MetabolismService } from '@claw/core/lib/maintenance/metabolism';
import { DynamoMemory } from '@claw/core/lib/memory';
import { HTTP_STATUS } from '@claw/core/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * Trigger regenerative metabolism audit and repairs.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const repair = body.repair === true;

    logger.info(`[API] Metabolism trigger - repair: ${repair}`);

    const memory = new DynamoMemory();
    const findings = await MetabolismService.runMetabolismAudit(memory, { repair });

    return NextResponse.json({
      success: true,
      findings,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Metabolism API failed:', error);
    return NextResponse.json(
      { error: 'Metabolism audit failed', details: (error as Error).message },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
