import { Resource } from 'sst';
import { realtime } from 'sst/aws/realtime';

/**
 * Enhanced SST Realtime Authorizer for Diagnostics.
 * Logs full event and implements robust token extraction.
 */
export const handler = async (event: any, context: any, callback: any) => {
  // 1. Log EVERYTHING for diagnostics
  console.log('[RealtimeAuth] RAW_EVENT:', JSON.stringify(event));

  let token: string | null = null;

  // 2. Multi-path token extraction
  // a. From protocolData (WebSocket query string)
  if (event.protocolData?.http?.queryString) {
    const params = new URLSearchParams(event.protocolData.http.queryString);
    token = params.get('x-amz-customauthorizer-token') || params.get('token');
  }

  // b. From top-level fields (MQTT direct or transformed)
  if (!token) {
    token =
      event.token ||
      event.queryStringParameters?.['x-amz-customauthorizer-token'] ||
      event.queryStringParameters?.token ||
      null;
  }

  // c. From MQTT password
  if (!token && event.protocolData?.mqtt?.password) {
    token = Buffer.from(event.protocolData.mqtt.password, 'base64').toString();
  }

  console.log(`[RealtimeAuth] Detected Token: ${token ? token.substring(0, 5) + '...' : 'NONE'}`);

  // 3. Create the authorizer
  const auth = realtime.authorizer(async (validatedToken) => {
    const prefix = `${Resource.App.name}/${Resource.App.stage}`;
    const finalToken = validatedToken || token;

    // LENIENT FOR DEV: Allow connection even if token is missing but it's a local/dev handshake
    const isDevToken = finalToken === 'dashboard-dev-token-elegant';
    const isActuallyMissing = !finalToken || finalToken.length < 10;

    console.log(
      `[RealtimeAuth] Decision: isDevToken=${isDevToken}, isActuallyMissing=${isActuallyMissing}, finalTokenLen=${finalToken?.length ?? 0}`
    );

    if (isActuallyMissing && !isDevToken) {
      console.warn(
        `[RealtimeAuth] ❌ Denied: Token too short or missing (${finalToken?.length ?? 0} chars)`
      );
      return { publish: [], subscribe: [] };
    }

    console.log(`[RealtimeAuth] ✅ Authorized for scope: ${prefix}/*`);
    return {
      publish: [`${prefix}/*`],
      subscribe: [`${prefix}/*`],
    };
  });

  // Inject token so SST's internal logic might find it
  if (token && !event.token) event.token = token;

  return auth(event, context, callback);
};
