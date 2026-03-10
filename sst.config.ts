/// <reference path="./.sst/platform/config.d.ts" />

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
    // SST v3 Modular Infrastructure via Dynamic Imports
    const { createStorage } = await import('./infra/storage.js');
    const { createBus } = await import('./infra/bus.js');
    const { createDeployer } = await import('./infra/deployer.js');
    const { createApi } = await import('./infra/api.js');
    const { createAgents } = await import('./infra/agents.js');
    const { createDashboard } = await import('./infra/dashboard.js');

    // 1. Storage & Secrets
    const { memoryTable, traceTable, configTable, stagingBucket, secrets } = createStorage();

    // 2. Multi-Agent Orchestration (EventBridge)
    const { bus } = createBus();

    // 3. The Deployer (CodeBuild)
    const { deployer } = createDeployer({
      stagingBucket,
      githubToken: secrets.GitHubToken,
    });

    // 4. Webhook API
    const { api } = createApi({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      secrets,
      bus,
      deployer,
    });

    // 5. Sub-Agents (Handlers & Logic)
    createAgents({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      secrets,
      bus,
      deployer,
      api,
    });

    // 6. ClawCenter (Next.js 16)
    const { dashboard } = createDashboard({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      secrets,
      bus,
      deployer,
      api,
    });

    return {
      apiUrl: api.url,
      dashboardUrl: dashboard.url,
      deployerName: deployer.name,
      busName: bus.name,
    };
  },
});
