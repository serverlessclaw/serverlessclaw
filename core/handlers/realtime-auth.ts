const AUTH_SESSION_TTL_SECONDS = 3600; // 1 hour
const AUTH_REFRESH_INTERVAL_SECONDS = 300; // 5 minutes

/**
 * Simple authorizer for IoT Realtime bus.
 * Requires a valid token in the query string for authentication.
 */
const authCache = new Map<string, { policy: any; principalId: string; expires: number }>();

export const handler = async (event: any) => {
  // Enhanced Authorizer support (IoT Core)
  const protocolData = event.protocolData;
  let queryString: Record<string, string> = event.queryString || event.queryContext || {};

  // If it's an enhanced authorizer, the query string might be in protocolData.http
  if (protocolData?.http?.queryString) {
    const params = new URLSearchParams(protocolData.http.queryString);
    const parsedQuery: Record<string, string> = {};
    params.forEach((value, key) => {
      parsedQuery[key] = value;
    });
    queryString = { ...queryString, ...parsedQuery };
  }

  // Also check mqtt username/password just in case it's passed there
  const mqttToken =
    (protocolData?.mqtt?.password
      ? Buffer.from(protocolData.mqtt.password, 'base64').toString()
      : undefined) || protocolData?.mqtt?.username;

  const token = event.token || queryString.token || event.headers?.token || mqttToken;
  const clientId = protocolData?.mqtt?.clientId;
  const messageType = protocolData?.mqtt?.messageType || 'UNKNOWN';

  if (!token || typeof token !== 'string' || token.length < 10) {
    console.warn(
      `[AUTH] Invalid or missing token for ${messageType}. Event structure:`,
      JSON.stringify({
        messageType,
        hasToken: !!event.token,
        hasQueryString: !!event.queryString,
        hasHeaders: !!event.headers,
        hasProtocolData: !!event.protocolData,
        tokenType: typeof token,
        tokenLength: token?.length,
      })
    );
    return {
      isAuthenticated: false,
      principalId: 'unauthorized',
      disconnectAfterInSeconds: 0,
      refreshAfterInSeconds: 0,
      policyDocuments: [],
    };
  }

  const principalId = `user-${token.substring(0, 16).replace(/[^a-zA-Z0-9]/g, '')}`;
  console.info(
    `[AUTH] [${messageType}] Authenticating clientId: ${clientId} for principal: ${principalId}`
  );
  const cached = authCache.get(token);
  if (cached && cached.expires > Date.now()) {
    console.info(`[AUTH] [${messageType}] Cache hit for principal: ${cached.principalId}`);
    return {
      isAuthenticated: true,
      principalId: cached.principalId,
      disconnectAfterInSeconds: AUTH_SESSION_TTL_SECONDS,
      refreshAfterInSeconds: AUTH_REFRESH_INTERVAL_SECONDS,
      policyDocuments: [JSON.stringify(cached.policy)],
    };
  }

  console.info(`[AUTH] [${messageType}] Authorized new connection for principal: ${principalId}`);
  const dashboardClientResource = 'arn:aws:iot:*:*:client/dashboard-*';
  const principalClientResource = `arn:aws:iot:*:*:client/${principalId}`;

  const appTopicResources = [
    'arn:aws:iot:*:*:topic/users/*',
    'arn:aws:iot:*:*:topic/workspaces/*',
    'arn:aws:iot:*:*:topic/collaborations/*',
    'arn:aws:iot:*:*:topic/agents/*',
    'arn:aws:iot:*:*:topic/tasks/*',
    'arn:aws:iot:*:*:topic/system/*',
    'arn:aws:iot:*:*:topic/system/metrics',
    `arn:aws:iot:*:*:topic/${principalId}/*`,
  ];

  const appTopicFilterResources = [
    'arn:aws:iot:*:*:topicfilter/users/*',
    'arn:aws:iot:*:*:topicfilter/workspaces/*',
    'arn:aws:iot:*:*:topicfilter/collaborations/*',
    'arn:aws:iot:*:*:topicfilter/agents/*',
    'arn:aws:iot:*:*:topicfilter/tasks/*',
    'arn:aws:iot:*:*:topicfilter/system/*',
    'arn:aws:iot:*:*:topicfilter/system/metrics',
    `arn:aws:iot:*:*:topicfilter/${principalId}/*`,
  ];

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'iot:Connect',
        Effect: 'Allow',
        Resource: [dashboardClientResource, principalClientResource],
      },
      {
        Action: ['iot:Publish', 'iot:Receive'],
        Effect: 'Allow',
        Resource: appTopicResources,
      },
      {
        Action: 'iot:Subscribe',
        Effect: 'Allow',
        Resource: appTopicFilterResources,
      },
    ],
  };

  // Cache the successful result
  authCache.set(token, {
    policy,
    principalId,
    expires: Date.now() + AUTH_REFRESH_INTERVAL_SECONDS * 1000, // Cache for 5 minutes within this Lambda instance
  });

  console.info(`[AUTH] Authorized new connection for principal: ${principalId}`);
  return {
    isAuthenticated: true,
    principalId,
    disconnectAfterInSeconds: AUTH_SESSION_TTL_SECONDS,
    refreshAfterInSeconds: AUTH_REFRESH_INTERVAL_SECONDS,
    policyDocuments: [JSON.stringify(policy)],
  };
};
