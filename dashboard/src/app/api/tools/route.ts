import { NextResponse } from 'next/server';
import { tools } from '@/lib/tool-definitions';
import { HTTP_STATUS } from '@/lib/constants';
import { getToolUsage, getAllTools } from '@/lib/tool-utils';

export const dynamic = 'force-dynamic';

// moved helpers to dashboard/src/lib/tool-utils.ts

export async function GET() {
  try {
    const usage = await getToolUsage();
    const allTools = await getAllTools(usage);
    return NextResponse.json(allTools);
  } catch (error) {
    console.error('Failed to fetch tools:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
