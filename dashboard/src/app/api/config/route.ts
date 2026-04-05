import { NextResponse, NextRequest } from 'next/server';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CONFIG_KEYS } from '@claw/core/lib/constants';

export const dynamic = 'force-dynamic';

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);

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
        authorizer: realtime.authorizer,
      },
    });
  } catch (error) {
    console.error('[Config API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

/**
 * Updates system configuration values.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
    }

    // Only allow specific safe keys to be updated from the client if needed,
    // or keep it generic if the dashboard is protected.
    if (key === CONFIG_KEYS.ACTIVE_LOCALE) {
      await docClient.send(
        new PutCommand({
          TableName: Resource.ConfigTable.name,
          Item: {
            key: key,
            value: value,
          },
        })
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unauthorized configuration key' }, { status: 403 });
  } catch (error) {
    console.error('[Config API] POST Error:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
