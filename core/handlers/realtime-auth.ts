const AUTH_SESSION_TTL_SECONDS = 3600; // 1 hour
const AUTH_REFRESH_INTERVAL_SECONDS = 300; // 5 minutes

/**
 * Simple authorizer for IoT Realtime bus.
 * Requires a valid token in the query string for authentication.
 */
export const handler = async (event: { queryString?: Record<string, string> }) => {
  const queryString = event.queryString || {};
  const token = queryString.token;

  if (!token || typeof token !== 'string' || token.length < 10) {
    return {
      isAuthenticated: false,
      principalId: 'unauthorized',
      disconnectAfterInSeconds: 0,
      refreshAfterInSeconds: 0,
      policyDocuments: [],
    };
  }

  const principalId = `user-${token.substring(0, 16).replace(/[^a-zA-Z0-9]/g, '')}`;

  // Allow the principal to connect as a client and interact with
  // both principal-scoped topics and the application topic namespaces
  // used by the realtime bridge (users, workspaces, collaborations, system/metrics).
  const appTopicResources = [
    'arn:aws:iot:*:*:topic/users/*',
    'arn:aws:iot:*:*:topic/workspaces/*',
    'arn:aws:iot:*:*:topic/collaborations/*',
    'arn:aws:iot:*:*:topic/system/metrics',
  ];

  const appTopicFilterResources = [
    'arn:aws:iot:*:*:topicfilter/users/*',
    'arn:aws:iot:*:*:topicfilter/workspaces/*',
    'arn:aws:iot:*:*:topicfilter/collaborations/*',
    'arn:aws:iot:*:*:topicfilter/system/metrics',
  ];

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'iot:Connect',
        Effect: 'Allow',
        Resource: `arn:aws:iot:*:*:client/${principalId}*`,
      },
      // Keep a principal-scoped publish/receive rule (backwards compatible for tests)
      {
        Action: ['iot:Publish', 'iot:Receive'],
        Effect: 'Allow',
        Resource: `arn:aws:iot:*:*:topic/${principalId}/*`,
      },
      // Also allow application topic namespaces used by the realtime bridge
      {
        Action: ['iot:Publish', 'iot:Receive'],
        Effect: 'Allow',
        Resource: appTopicResources,
      },
      // Principal-scoped subscribe
      {
        Action: 'iot:Subscribe',
        Effect: 'Allow',
        Resource: `arn:aws:iot:*:*:topicfilter/${principalId}/*`,
      },
      // Application topicfilter permissions
      {
        Action: 'iot:Subscribe',
        Effect: 'Allow',
        Resource: appTopicFilterResources,
      },
    ],
  };

  return {
    isAuthenticated: true,
    principalId,
    disconnectAfterInSeconds: AUTH_SESSION_TTL_SECONDS,
    refreshAfterInSeconds: AUTH_REFRESH_INTERVAL_SECONDS,
    policyDocuments: [JSON.stringify(policy)],
  };
};
