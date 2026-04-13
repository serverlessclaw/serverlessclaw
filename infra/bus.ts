/**
 * Creates the event bus and realtime communication resources for agent orchestration.
 *
 * @returns An object containing the AgentBus (EventBridge), RealtimeBus (IoT Core), and DLQ (SQS) instances.
 */
export function createBus() {
  const bus = new sst.aws.Bus('AgentBus');
  const realtime = new sst.aws.Realtime('RealtimeBus', {
    authorizer: {
      handler: 'core/handlers/realtime-auth.handler',
      tokenKeyName: 'token',
      logging: {
        retention: '1 month',
      },
    },
  });

  // B3: Dead Letter Queue for EventBridge failed events
  const dlq = new sst.aws.Queue('EventDLQ', {
    transform: {
      queue: {
        messageRetentionSeconds: 14 * 24 * 60 * 60, // 14 days retention
        visibilityTimeoutSeconds: 300, // 5 minutes visibility timeout
      },
    },
  });

  return { bus, realtime, dlq };
}
