import { Resource } from 'sst';
import { 
  SchedulerClient, 
  ListSchedulesCommand, 
  GetScheduleCommand,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
  FlexibleTimeWindowMode,
  ActionAfterCompletion
} from '@aws-sdk/client-scheduler';
import { NextResponse } from 'next/server';
import { HTTP_STATUS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const scheduler = new SchedulerClient({});

/**
 * GET handler to list all schedules.
 */
export async function GET() {
  try {
    const { Schedules } = await scheduler.send(new ListSchedulesCommand({}));
    
    if (!Schedules) return NextResponse.json([]);

    const detailedSchedules = await Promise.all(
      Schedules.map(async (s) => {
        try {
          if (!s.Name) return null;
          const details = await scheduler.send(new GetScheduleCommand({ Name: s.Name }));
          return {
            ...s,
            Target: details.Target,
            Description: details.Description,
            CreationDate: details.CreationDate,
          };
        } catch (e) {
          console.error(`Failed to fetch details for schedule ${s.Name}:`, e);
          return s;
        }
      })
    );

    return NextResponse.json(detailedSchedules.filter(Boolean));
  } catch (error) {
    console.error('Failed to fetch schedules:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedules', details: error instanceof Error ? error.message : String(error) }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * POST handler to "Trigger Now" (create a one-time execution).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, action } = body;

    if (action === 'trigger') {
      const existing = await scheduler.send(new GetScheduleCommand({ Name: name }));
      if (!existing || !existing.Target) {
        return NextResponse.json({ error: 'Schedule target not found' }, { status: 404 });
      }

      // Create a one-time execution schedule that fires "now" (plus a few seconds to be safe)
      const triggerName = `TRIGGER-${name}-${Date.now()}`;
      const now = new Date();
      now.setSeconds(now.getSeconds() + 5);
      const atExpression = `at(${now.toISOString().split('.')[0]})`;

      await scheduler.send(new CreateScheduleCommand({
        Name: triggerName,
        ScheduleExpression: atExpression,
        Target: existing.Target,
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        ActionAfterCompletion: ActionAfterCompletion.DELETE,
        Description: `One-time trigger for ${name}`,
      }));

      return NextResponse.json({ success: true, triggerName });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Failed to trigger schedule:', error);
    return NextResponse.json(
      { error: 'Failed to trigger schedule', details: error instanceof Error ? error.message : String(error) }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * PATCH handler to Pause/Resume a schedule.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { name, state } = body; // 'ENABLED' or 'DISABLED'

    const existing = await scheduler.send(new GetScheduleCommand({ Name: name }));
    if (!existing) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    await scheduler.send(new UpdateScheduleCommand({
      ...existing,
      State: state,
    }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update schedule:', error);
    return NextResponse.json(
      { error: 'Failed to update schedule', details: error instanceof Error ? error.message : String(error) }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * DELETE handler to remove a schedule.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ error: 'Schedule name is required' }, { status: 400 });
    }

    await scheduler.send(new DeleteScheduleCommand({ Name: name }));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete schedule:', error);
    return NextResponse.json(
      { error: 'Failed to delete schedule', details: error instanceof Error ? error.message : String(error) }, 
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
