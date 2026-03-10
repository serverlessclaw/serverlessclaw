export function createBus() {
  const bus = new sst.aws.Bus('AgentBus');
  return { bus };
}
