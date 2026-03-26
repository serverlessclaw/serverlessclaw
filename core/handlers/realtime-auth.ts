const AUTH_SESSION_TTL_SECONDS = 3600; // 1 hour
const AUTH_REFRESH_INTERVAL_SECONDS = 300; // 5 minutes

/**
 * Simple authorizer for IoT Realtime bus.
 */
export const handler = async (_event: unknown) => {
  // Use a stable principalId for the dashboard (must be alphanumeric)
  const principalId = 'dashboardUser';

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'iot:Connect',
        Effect: 'Allow',
        Resource: 'arn:aws:iot:*:*:client/*',
      },
      {
        Action: ['iot:Publish', 'iot:Receive'],
        Effect: 'Allow',
        Resource: 'arn:aws:iot:*:*:topic/*',
      },
      {
        Action: 'iot:Subscribe',
        Effect: 'Allow',
        Resource: 'arn:aws:iot:*:*:topicfilter/*',
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
