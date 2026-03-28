/**
 * Creates the event bus and realtime communication resources for agent orchestration.
 *
 * @returns An object containing the AgentBus (EventBridge) and RealtimeBus (IoT Core) instances.
 */
export function createBus() {
  const bus = new sst.aws.Bus('AgentBus');
  const realtime = new sst.aws.Realtime('RealtimeBus', {
    authorizer: {
      handler: 'core/handlers/realtime-auth.handler',
      logging: {
        retention: '1 month',
      },
    },
  });
  return { bus, realtime };
}
