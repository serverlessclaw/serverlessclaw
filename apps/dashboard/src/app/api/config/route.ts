import { NextResponse, NextRequest } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CONFIG_KEYS } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';
import { getConfigTableName } from '@claw/core/lib/utils/ddb-client';
import { getAppInfo, getRealtimeInfo } from '@claw/core/lib/utils/resource-helpers';
import { AUTH } from '@/lib/constants';

export const dynamic = 'force-dynamic';

let docClientInstance: DynamoDBDocumentClient | null = null;

function getDocClient() {
  if (!docClientInstance) {
    const dbClient = new DynamoDBClient({});
    docClientInstance = DynamoDBDocumentClient.from(dbClient);
  }
  return docClientInstance;
}

/**
 * Returns public configuration for the dashboard.
 * Safe to call from client components.
 */
export async function GET(req: NextRequest) {
  try {
    // 0. Manual Auth Check (Fallback if middleware/proxy is bypassed)
    const sessionToken = req.cookies.get(AUTH.COOKIE_NAME);
    if (!sessionToken || sessionToken.value !== AUTH.COOKIE_VALUE) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Debug diagnostic: log the MQTT URL being used by the client
    const debugUrl = req.nextUrl?.searchParams?.get('__debug_url');
    if (debugUrl) {
      logger.debug('[Config API] [DEBUG] Client MQTT URL:', decodeURIComponent(debugUrl));
      return NextResponse.json({ ok: true });
    }

    const { url: realtimeUrl, authorizer } = getRealtimeInfo();
    const appInfo = getAppInfo();

    if (!realtimeUrl) {
      logger.info(
        '[Config API] RealtimeBus is not linked; realtime functionality will be unavailable.'
      );
    }

    return NextResponse.json({
      app: appInfo.name,
      stage: appInfo.stage,
      realtime: {
        url: realtimeUrl,
        authorizer: authorizer,
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
    // 0. Manual Auth Check
    const sessionToken = req.cookies.get(AUTH.COOKIE_NAME);
    if (!sessionToken || sessionToken.value !== AUTH.COOKIE_VALUE) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
    }

    // Only allow specific safe keys to be updated from the client if needed,
    // or keep it generic if the dashboard is protected.
    if (key === CONFIG_KEYS.ACTIVE_LOCALE) {
      const tableName = getConfigTableName();
      if (!tableName) {
        return NextResponse.json({ error: 'ConfigTable name is missing' }, { status: 500 });
      }
      await getDocClient().send(
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
