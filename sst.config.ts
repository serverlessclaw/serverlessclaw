/// <reference path=".sst/platform/config.d.ts" />
import { createStorage } from './src/infra/storage';
import { createBus } from './src/infra/bus';
import { createDeployer } from './src/infra/deployer';
import { createApi } from './src/infra/api';
import { createAgents } from './src/infra/agents';

export default $config({
  app(input) {
    return {
      name: 'serverlessclaw',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
    };
  },
  async run() {
    // 1. Storage & Secrets
    const { memoryTable, secrets } = createStorage();

    // 2. Multi-Agent Orchestration (EventBridge)
    const { bus } = createBus();

    // 3. The Deployer (CodeBuild)
    const { deployer } = createDeployer();

    // 4. Webhook API
    const { api } = createApi({ memoryTable, secrets, bus, deployer });

    // 5. Sub-Agents
    createAgents({ memoryTable, secrets, bus, deployer, api });

    return {
      apiUrl: api.url,
      deployerName: deployer.name,
      busName: bus.name,
    };
  },
});
