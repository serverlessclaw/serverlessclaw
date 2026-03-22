import { NextResponse } from 'next/server';
import { HTTP_STATUS } from '@/lib/constants';
import { getToolUsage, getAllTools } from '@/lib/tool-utils';

export const dynamic = 'force-dynamic';

// moved helpers to dashboard/src/lib/tool-utils.ts

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    const usage = await getToolUsage();
    const allTools = await getAllTools(usage, refresh);
    return NextResponse.json({ tools: allTools });
  } catch (error) {
    console.error('Failed to fetch tools:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
