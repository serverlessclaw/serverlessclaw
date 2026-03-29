/// <reference path="./.sst/platform/config.d.ts" />

const APP_CONFIG = {
  name: 'serverlessclaw',
  region: 'ap-southeast-2',
  architecture: 'arm64' as const,
  runtime: 'nodejs24.x',
  retention: '1 month' as const,
} as const;

/**
 * SST v3 Platform Configuration for ServerlessClaw.
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
        },
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
                'next',
                'react',
                'react-dom',
                'lucide-react',
                '@xyflow/react',
                '@opennextjs/aws',
                'sonner',
                'react-markdown',
                'remark-gfm',
                'raw-loader',
                '@tailwindcss/postcss',
                'tailwindcss',
                'mqtt',
              ],
            },
          },
        },
      },
    };
  },
  async run() {
    // SST v3 Modular Infrastructure via Dynamic Imports
    const { createStorage } = await import('./infra/storage.js');
    const { createBus } = await import('./infra/bus.js');
    const { createDeployer } = await import('./infra/deployer.js');
    const { createApi } = await import('./infra/api.js');
    const { createMCPServers } = await import('./infra/mcp-servers.js');
    const { createAgents } = await import('./infra/agents.js');
    const { createDashboard } = await import('./infra/dashboard.js');

    // 1. Storage & Secrets
    const { memoryTable, traceTable, configTable, stagingBucket, knowledgeBucket, secrets } =
      createStorage();

    // 2. Multi-Agent Orchestration (EventBridge)
    const { bus, realtime } = createBus();

    // 3. The Deployer (CodeBuild)
    const { deployer } = createDeployer({
      stagingBucket,
      githubToken: secrets.GitHubToken,
    });

    // 3.5 MCP Servers
    const mcpServers = createMCPServers({
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      secrets,
      bus,
      deployer,
    });

    // 4. API & Realtime
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

    // 5. Sub-Agents (Handlers & Logic)
    const { heartbeatHandler, schedulerRole } = createAgents(
      {
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
      },
      mcpServers
    );

    // 6. ClawCenter (Next.js 16)
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
      heartbeatHandler,
      schedulerRole,
    });

    return {
      apiUrl: api.url,
      dashboardUrl: dashboard.url,
    };
  },
});
