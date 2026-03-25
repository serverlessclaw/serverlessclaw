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
    disconnectAfterInSeconds: 3600,
    refreshAfterInSeconds: 300,
    policyDocuments: [JSON.stringify(policy)],
  };
};
