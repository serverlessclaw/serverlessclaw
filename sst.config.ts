/// <reference path="./.sst/platform/config.d.ts" />

const APP_CONFIG = {
  name: 'serverlessclaw',
  region: 'ap-southeast-2',
  architecture: 'arm64' as const,
  runtime: 'nodejs24.x',
  retention: '1 month' as const,
} as const;

/**
 * SST v4 Platform Configuration for ServerlessClaw.
 * Defines the main application entry point, infrastructure providers, and modular resource setup.
 */
export default $config({
  app(input) {
    return {
      name: APP_CONFIG.name,
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
      protect: ['prod'].includes(input?.stage),
      home: 'aws',
      providers: {
        aws: {
          region: APP_CONFIG.region,
          version: '7.23.0',
        },
        cloudflare: '6.13.0',
      },
      defaults: {
        function: {
          architecture: APP_CONFIG.architecture,
          environment: {
            AWS_PROFILE: '', // Clear profile to avoid conflict warning as SST injects static credentials
          },
          nodejs: {
            loader: {
              '.md': 'text',
            },
            esbuild: {
              // AWS SDK v3 is included in Lambda's managed Node.js 24.x runtime.
              // Externalizing it reduces bundle size by ~2-3MB per function.
              external: [
                '@aws-sdk/*',
                // Dashboard-only packages — safety net against accidental bundling
                'sonner',
                'react-markdown',
                'remark-gfm',
                'raw-loader',
                '@tailwindcss/postcss',
                'tailwindcss',
                'mqtt',
                'vitest',
                'playwright',
              ],
            },
          },
        },
      },
    };
  },
  async run() {
    // SST v4 Modular Infrastructure via Dynamic Imports
    const { createStorage } = await import('./infra/storage.js');
    const { createBus } = await import('./infra/bus.js');
    const { createDeployer } = await import('./infra/deployer.js');
    const { createApi, configureApiRoutes } = await import('./infra/api.js');
    const { createMCPServers } = await import('./infra/mcp-servers.js');
    const { createAgents } = await import('./infra/agents.js');
    const { createDashboard } = await import('./infra/dashboard.js');

    // 1. Storage & Secrets
    const { memoryTable, traceTable, configTable, stagingBucket, knowledgeBucket, secrets } =
      createStorage();

    // 2. Multi-Agent Orchestration (EventBridge)
    const { bus, realtime, dlq } = createBus();

    // 3. The Deployer (CodeBuild)
    const { deployer } = createDeployer({
      stagingBucket,
      githubToken: secrets.GitHubToken,
    });

    // 4. API Instance (Created early for linking, routes added later)
    const { api } = createApi({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      secrets,
      bus,
      deployer,
    });

    // 5. MCP Servers
    const mcpServers = createMCPServers({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      secrets,
      bus,
      deployer,
      api, // Now available for linking if needed
    });
    const multiplexer = mcpServers.multiplexer;

    // 6. Sub-Agents (Handlers & Logic)
    const agentResources = createAgents(
      {
        memoryTable,
        traceTable,
        configTable,
        stagingBucket,
        knowledgeBucket,
        secrets,
        bus,
        deployer,
        realtime,
        dlq,
        api, // Linkable API instance
        multiplexer,
      },
      mcpServers
    );

    // 7. API Routes (Configured after agents exist)
    configureApiRoutes(api, {
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      secrets,
      bus,
      deployer,
      agents: agentResources,
    });

    // 8. ClawCenter (Next.js 16)
    const { dashboard } = createDashboard({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      secrets,
      bus,
      deployer,
      api,
      realtime,
      multiplexer,
      heartbeatHandler: agentResources.heartbeatHandler,
      schedulerRole: agentResources.schedulerRole,
    });

    return {
      apiUrl: api.url,
      dashboardUrl: dashboard.url,
    };
  },
});
