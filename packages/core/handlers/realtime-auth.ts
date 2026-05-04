import { Resource } from 'sst';
import { realtime } from 'sst/aws/realtime';
import { logger } from '../lib/logger';

/**
 * Enhanced SST Realtime Authorizer for Diagnostics.
 * Logs full event and implements robust token extraction.
 */
export const handler = async (event: unknown, context: unknown, callback: unknown) => {
  // 1. Log EVERYTHING for diagnostics
  logger.info('[RealtimeAuth] RAW_EVENT:', JSON.stringify(event));

  const typedEvent = event as {
    protocolData?: {
      http?: { queryString?: string };
      mqtt?: { password?: string };
    };
    token?: string;
    queryStringParameters?: Record<string, string>;
  };

  let token: string | null = null;

  // 2. Multi-path token extraction
  // a. From protocolData (WebSocket query string)
  if (typedEvent.protocolData?.http?.queryString) {
    const params = new URLSearchParams(typedEvent.protocolData.http.queryString);
    token = params.get('x-amz-customauthorizer-token') || params.get('token');
  }

  // b. From top-level fields (MQTT direct or transformed)
  if (!token) {
    token =
      typedEvent.token ||
      typedEvent.queryStringParameters?.['x-amz-customauthorizer-token'] ||
      typedEvent.queryStringParameters?.token ||
      null;
  }

  // c. From MQTT password
  if (!token && typedEvent.protocolData?.mqtt?.password) {
    token = Buffer.from(typedEvent.protocolData.mqtt.password, 'base64').toString();
  }

  logger.info(`[RealtimeAuth] Detected Token: ${token ? token.substring(0, 5) + '...' : 'NONE'}`);

  // 3. Create the authorizer
  const auth = realtime.authorizer(async (validatedToken) => {
    const prefix = `${Resource.App.name}/${Resource.App.stage}`;
    const finalToken = (validatedToken as string | undefined) || token;

    // LENIENT FOR DEV: Allow connection even if token is missing but it's a local/dev handshake
    const isDevToken = finalToken === 'dashboard-dev-token-elegant';
    const isActuallyMissing = !finalToken || finalToken.length < 10;

    logger.info(
      `[RealtimeAuth] Decision: isDevToken=${isDevToken}, isActuallyMissing=${isActuallyMissing}, finalTokenLen=${finalToken?.length ?? 0}`
    );

    if (isActuallyMissing && !isDevToken) {
      logger.warn(
        `[RealtimeAuth] ❌ Denied: Token too short or missing (${finalToken?.length ?? 0} chars)`
      );
      return { publish: [], subscribe: [] };
    }

    logger.info(`[RealtimeAuth] ✅ Authorized for scope: ${prefix}/*`);
    return {
      publish: [`${prefix}/*`],
      subscribe: [`${prefix}/*`],
    };
  });

  // Inject token so SST's internal logic might find it
  if (token && !typedEvent.token) typedEvent.token = token;

  return (auth as (e: unknown, c: unknown, cb: unknown) => Promise<unknown>)(
    event,
    context,
    callback
  );
};
