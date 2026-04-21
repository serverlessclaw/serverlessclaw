import { NextResponse, NextRequest } from 'next/server';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CONFIG_KEYS } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';
import { SSTResource } from '@claw/core/lib/types/index';

export const dynamic = 'force-dynamic';

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);

/**
 * Returns public configuration for the dashboard.
 * Safe to call from client components.
 */
export async function GET(req: NextRequest) {
  try {
    // Debug diagnostic: log the MQTT URL being used by the client
    const debugUrl = req.nextUrl?.searchParams?.get('__debug_url');
    if (debugUrl) {
      logger.debug('[Config API] [DEBUG] Client MQTT URL:', decodeURIComponent(debugUrl));
      return NextResponse.json({ ok: true });
    }

    // Defensive check for SST Resource linking.
    // The sst library throws if accessing properties on Resource when links aren't active.
    let realtime: SSTResource['RealtimeBus'] | null = null;
    let realtimeUrl: string | null = null;
    const appInfo = { name: 'serverlessclaw', stage: 'local' };

    try {
      const resource = Resource as unknown as SSTResource;
      if (resource.RealtimeBus) {
        realtime = resource.RealtimeBus;
        realtimeUrl =
          realtime && typeof realtime.endpoint === 'string'
            ? realtime.endpoint.startsWith('wss://')
              ? realtime.endpoint
              : realtime.endpoint.startsWith('https://')
                ? realtime.endpoint.replace('https://', 'wss://')
                : `wss://${realtime.endpoint}`
            : null;
      }
      if (resource.App) {
        appInfo.name = resource.App.name || appInfo.name;
        appInfo.stage = resource.App.stage || appInfo.stage;
      }
    } catch (e) {
      logger.warn('[Config API] SST resources are not active or linked currently:', (e as Error).message);
    }

    if (!realtimeUrl) {
      logger.warn('[Config API] RealtimeBus is not linked or unavailable; using defaults');
    }

    return NextResponse.json({
      app: appInfo.name,
      stage: appInfo.stage,
      realtime: {
        url: realtimeUrl,
        authorizer: realtime?.authorizer,
      },
    });
  } catch (error) {
    logger.error('[Config API] Fatal Error:', error);
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
      const resource = Resource as unknown as SSTResource;
      const tableName = resource.ConfigTable?.name;
      if (!tableName) {
        return NextResponse.json({ error: 'ConfigTable name is missing' }, { status: 500 });
      }
      await docClient.send(
        new PutCommand({
          TableName: tableName,
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
    logger.error('[Config API] POST Error:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
